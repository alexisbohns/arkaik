"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PLATFORM_ICONS,
  PLATFORM_LABELS,
  STATUS_ICONS,
  STATUS_STYLES,
  STATUS_LABELS,
} from "@/components/graph/nodes/node-styles";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { Node, PlatformScreenshotsMap, PlatformStatusMap, PlatformNotesMap } from "@/lib/data/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ShotPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node?: Node;
  initialPlatform?: PlatformId;
}

export function ShotPreviewDialog({
  open,
  onOpenChange,
  node,
  initialPlatform,
}: ShotPreviewDialogProps) {
  const platforms = node?.platforms ?? [];
  const screenshots: PlatformScreenshotsMap = (node?.metadata?.platformScreenshots as PlatformScreenshotsMap) ?? {};
  const platformStatuses: PlatformStatusMap = (node?.metadata?.platformStatuses as PlatformStatusMap) ?? {};
  const platformNotes: PlatformNotesMap = (node?.metadata?.platformNotes as PlatformNotesMap) ?? {};

  // Platforms that actually have a screenshot
  const platformsWithShots = platforms.filter((p) => screenshots[p]);

  const [activeTab, setActiveTab] = useState<PlatformId>(
    initialPlatform ?? platformsWithShots[0] ?? platforms[0] ?? "web",
  );

  // Reset active tab when dialog opens with a new node/platform
  useEffect(() => {
    if (open) {
      setActiveTab(
        initialPlatform ?? platformsWithShots[0] ?? platforms[0] ?? "web",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, node?.id, initialPlatform]);

  const currentIndex = platformsWithShots.indexOf(activeTab);

  const goToPrev = useCallback(() => {
    if (platformsWithShots.length <= 1) return;
    const prevIndex = currentIndex <= 0 ? platformsWithShots.length - 1 : currentIndex - 1;
    setActiveTab(platformsWithShots[prevIndex]);
  }, [currentIndex, platformsWithShots]);

  const goToNext = useCallback(() => {
    if (platformsWithShots.length <= 1) return;
    const nextIndex = currentIndex >= platformsWithShots.length - 1 ? 0 : currentIndex + 1;
    setActiveTab(platformsWithShots[nextIndex]);
  }, [currentIndex, platformsWithShots]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNext();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, goToPrev, goToNext]);

  const currentScreenshot = screenshots[activeTab];
  const currentStatus = platformStatuses[activeTab] ?? node?.status ?? ("idea" as StatusId);
  const currentNotes = platformNotes[activeTab] ?? "";
  const StatusIcon = STATUS_ICONS[currentStatus] ?? STATUS_ICONS.idea;
  const statusStyles = STATUS_STYLES[currentStatus] ?? STATUS_STYLES.idea;

  if (!node) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[90vw] max-h-[85vh] p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">{node.title} — Screenshot Preview</DialogTitle>

        <div className="flex flex-col md:flex-row h-full max-h-[85vh]">
          {/* Main image area */}
          <div className="relative flex flex-1 items-center justify-center bg-muted/30 min-h-[300px] md:min-h-0 p-6">
            {currentScreenshot ? (
              <img
                src={currentScreenshot}
                alt={`${node.title} — ${PLATFORM_LABELS[activeTab]} screenshot`}
                className="max-h-[70vh] max-w-full object-contain rounded-md"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <span className="text-sm">No screenshot for {PLATFORM_LABELS[activeTab]}</span>
              </div>
            )}

            {/* Prev/Next arrows */}
            {platformsWithShots.length > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-2 top-1/2 -translate-y-1/2 size-8 rounded-full bg-background/80 backdrop-blur-sm cursor-pointer"
                  onClick={goToPrev}
                  aria-label="Previous platform"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 size-8 rounded-full bg-background/80 backdrop-blur-sm cursor-pointer"
                  onClick={goToNext}
                  aria-label="Next platform"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </>
            )}
          </div>

          {/* Metadata sidebar */}
          <div className="flex flex-col w-full md:w-72 border-t md:border-t-0 md:border-l border-border bg-background overflow-y-auto">
            {/* Platform tabs */}
            <div role="tablist" className="flex border-b border-border shrink-0">
              {platforms.map((p) => {
                const PlatformIcon = PLATFORM_ICONS[p];
                const hasShot = Boolean(screenshots[p]);

                return (
                  <button
                    key={p}
                    type="button"
                    role="tab"
                    aria-selected={p === activeTab}
                    onClick={() => setActiveTab(p)}
                    className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px flex-1 justify-center ${
                      p === activeTab
                        ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    } ${!hasShot ? "opacity-50" : ""}`}
                  >
                    <PlatformIcon className="size-3.5" />
                    {PLATFORM_LABELS[p]}
                  </button>
                );
              })}
            </div>

            {/* Metadata content */}
            <div className="flex flex-col gap-4 p-4">
              {/* Node title */}
              <div>
                <h3 className="text-sm font-semibold leading-tight">{node.title}</h3>
              </div>

              {/* Platform & Status */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Status
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <StatusIcon className={`size-3.5 ${statusStyles.badge}`} />
                    {STATUS_LABELS[currentStatus]}
                  </span>
                </div>
              </div>

              {/* Description */}
              {node.description && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Description
                  </span>
                  <p className="text-xs text-foreground leading-relaxed">
                    {node.description}
                  </p>
                </div>
              )}

              {/* Platform notes */}
              {currentNotes && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Notes
                  </span>
                  <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                    {currentNotes}
                  </p>
                </div>
              )}

              {/* Gallery indicator */}
              {platformsWithShots.length > 1 && (
                <div className="flex items-center justify-center gap-1.5 pt-2">
                  {platformsWithShots.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setActiveTab(p)}
                      className={`size-1.5 rounded-full transition-colors ${
                        p === activeTab ? "bg-foreground" : "bg-muted-foreground/30"
                      }`}
                      aria-label={`View ${PLATFORM_LABELS[p]} screenshot`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
