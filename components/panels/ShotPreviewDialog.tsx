"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PLATFORM_ICONS,
  PLATFORM_LABELS,
  STATUS_ICONS,
  STATUS_STYLES,
  STATUS_LABELS,
} from "@/components/graph/nodes/node-styles";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { Node, PlatformScreenshotsMap, PlatformStatusMap, PlatformNotesMap } from "@/lib/data/types";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
// The class only — these three are read-only display pairs, not form fields,
// so they take the micro-label style without claiming to label a control.
import { FIELD_LABEL_CLASS } from "@/components/ui/field";
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

  /**
   * Arrow keys page the **gallery** — the platforms that actually have a
   * screenshot — which is a different set from the tab strip's, and the reason
   * the two have to be kept apart now that the strip is real Radix tabs.
   *
   * Inside the strip, arrows belong to the WAI-ARIA tabs contract and Radix
   * already handles them (roving tabindex over every platform, shot or not).
   * This listener is on `window`, so without the guard both would fire on one
   * keypress and the selection would jump two places at once. Everywhere else in
   * the dialog — the image, the close button, the dots — arrows still mean
   * "next screenshot", which is what they have always meant here.
   */
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as Element | null;
      if (target?.closest?.('[data-slot="tabs-list"]')) return;
      e.preventDefault();
      if (e.key === "ArrowLeft") goToPrev();
      else goToNext();
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

  const ActivePlatformIcon = PLATFORM_ICONS[activeTab];

  /**
   * The sidebar's per-platform readout — status and notes change with the
   * selected platform, so this is what the tab strip actually controls and what
   * `TabsContent` wraps when there is a strip at all.
   */
  const metadata = (
    <>
      {/* Node title */}
      <div>
        <h3 className="text-sm font-semibold leading-tight">{node.title}</h3>
      </div>

      {/* Platform & Status */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className={FIELD_LABEL_CLASS}>Status</span>
          <span className="inline-flex items-center gap-1.5 text-xs">
            <StatusIcon className={`size-3.5 ${statusStyles.badge}`} />
            {STATUS_LABELS[currentStatus]}
          </span>
        </div>
      </div>

      {/* Description */}
      {node.description && (
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL_CLASS}>Description</span>
          <p className="text-xs text-foreground leading-relaxed">
            {node.description}
          </p>
        </div>
      )}

      {/* Platform notes */}
      {currentNotes && (
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL_CLASS}>Notes</span>
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
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The shared `DialogContent`, not a hand-rebuilt overlay + content pair
          (audit `shadcn-1`). The only thing the copy bought was placing the
          close button in the sidebar header instead of the top-right corner,
          which `showCloseButton={false}` now buys without duplicating the
          wrapper's class strings. The overrides undo the wrapper's default
          padded grid card: this dialog is an edge-to-edge two-pane layout, and
          tailwind-merge lets `max-w-5xl` beat `max-w-lg`. */}
      <DialogContent
        showCloseButton={false}
        className="block w-[90vw] max-w-5xl gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">{node.title} — Screenshot Preview</DialogTitle>

        <div className="flex flex-col md:flex-row max-h-[85vh]">
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
            {/* Header with active platform + close button */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
              <span className="inline-flex items-center gap-2 text-sm font-medium">
                <ActivePlatformIcon className="size-4" />
                {PLATFORM_LABELS[activeTab]}
              </span>
              <DialogClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground cursor-pointer"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </Button>
              </DialogClose>
            </div>

            {platforms.length > 1 ? (
              // `contents` so the Radix root adds no box of its own: the strip
              // and the panel stay direct rows of the sidebar column they were
              // before, and only the roles and the keyboard change.
              <Tabs
                variant="underline"
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as PlatformId)}
                className="contents"
              >
                <TabsList className="shrink-0">
                  {platforms.map((p) => {
                    const PlatformIcon = PLATFORM_ICONS[p];
                    const hasShot = Boolean(screenshots[p]);

                    return (
                      <TabsTrigger
                        key={p}
                        value={p}
                        // Dimmed, not disabled: a platform with no shot is still
                        // worth opening — the panel then says so, and says what
                        // status and notes it has.
                        className={`flex-1 py-2 ${!hasShot ? "opacity-50" : ""}`}
                      >
                        <PlatformIcon className="size-3.5" />
                        {PLATFORM_LABELS[p]}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
                <TabsContent value={activeTab} className="flex flex-col gap-4 p-4">
                  {metadata}
                </TabsContent>
              </Tabs>
            ) : (
              // One platform, so there is no strip — and no `TabsContent`
              // either, whose `aria-labelledby` would point at a tab that does
              // not exist.
              <div className="flex flex-col gap-4 p-4">{metadata}</div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
