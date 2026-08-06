"use client";

import { useId, useRef, useState } from "react";
import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORMS } from "@/lib/config/platforms";
import { PLATFORM_ICONS, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { PlatformStatusMap } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import { platformAvailabilityShape } from "@/lib/utils/product-scope";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  /**
   * The **scope's** platform menu — `scope.platforms` — and the sole input to
   * the arity rule below. Required, because an omitted list used to mean "every
   * configured platform", which is exactly the admin-view-with-an-iOS-tab bug
   * this feature exists to close.
   *
   * Deliberately the menu and **not** `scopedPlatforms(node, scope)`: how many
   * platform columns a surface shows is a *shape* decision, and shape decisions
   * belong to the scope — the same input the Acceptances matrix reads for its
   * status columns and the Pyramid for its rings. The per-node answer would
   * degrade to `node.platforms` whenever no product is declared, collapsing a
   * web-only view's strip in a project that has never heard of products.
   * `scopedPlatforms` is for per-node *facts*, like the chips in `PlatformList`.
   */
  platforms: PlatformId[];
  /** Tab opened on mount (e.g. the platform of the clicked Delivery item). */
  initialPlatform?: PlatformId;
  onStatusChange?: (platform: PlatformId, value: StatusId | undefined) => void;
  onNotesChange?: (platform: PlatformId, value: string) => void;
  onScreenshotChange?: (platform: PlatformId, value: string | undefined) => void;
  onZoomShot?: (platform: PlatformId) => void;
}

/**
 * The per-platform editor — one tab strip over status, notes, and a screenshot.
 *
 * **The arity rule decides whether there is a strip at all**, read off
 * `platformAvailabilityShape` so this cannot drift from the Pyramid's rings or
 * the Acceptances matrix's status columns: two or more platforms in the scope's
 * menu get tabs, one or zero get a single unlabelled status and no platform
 * chrome — the same collapse, now on a third surface.
 *
 * **Per-platform notes, statuses, and screenshots for a platform outside the
 * menu are neither rendered nor deleted.** They sit untouched in
 * `metadata`, and every handler here patches by spreading the stored map, so a
 * node edited under a web-only scope round-trips its iOS note intact. Nothing
 * is lost; it is simply not shown.
 */
export function PlatformVariants({
  statuses = {},
  notes = {},
  screenshots = {},
  platforms,
  initialPlatform,
  onStatusChange,
  onNotesChange,
  onScreenshotChange,
  onZoomShot,
}: PlatformVariantsProps) {
  const showTabs = platformAvailabilityShape(platforms) === "rings";
  // At arity 0 there is no platform to bind an editor to — editing and
  // validation at arity 0 are P3 (§ Decision 3) — so the fields fall back to
  // the first configured platform rather than disappearing and stranding
  // whatever notes or screenshot the node already carries. Arity 0 and 1 still
  // render identically, because neither draws a tab or a platform name.
  const [selectedTab, setActiveTab] = useState<PlatformId>(() => {
    if (initialPlatform && platforms.includes(initialPlatform)) return initialPlatform;
    return platforms[0] ?? PLATFORMS[0].id;
  });
  // Derived rather than synced by an effect: the scope can change under a mounted
  // panel, and a selection left pointing at a platform that just left the menu
  // would edit a field nothing renders. Falling back in render means there is no
  // frame where the two disagree.
  const activeTab = platforms.includes(selectedTab) ? selectedTab : platforms[0] ?? PLATFORMS[0].id;
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Per-mount, not `platform-notes-${activeTab}` as before: the panel stack keeps
  // hidden panels mounted, so two of these editors can share a document and a
  // hand-written id would point both labels at whichever textarea mounted first.
  const fieldId = useId();
  const currentStatus = statuses[activeTab];
  const currentNotes = notes[activeTab] ?? "";
  const currentScreenshot = screenshots[activeTab];
  // No platform name at arity ≤ 1: the scope selector already says "Admin — Web
  // only", so repeating it on every label is chrome that earns nothing — and
  // dropping it is what makes arity 0 and arity 1 literally identical.
  const platformSuffix = showTabs ? ` for ${PLATFORM_LABELS[activeTab]}` : "";

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

  const fields = (
    <>
      <Field label="Status" htmlFor={`${fieldId}-status`}>
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
          {/* The `aria-label` stays even though the field now has a real label,
              and deliberately outranks it: every tab shows a control called
              "Status", and only the suffix says which platform this one edits. */}
          <SelectTrigger id={`${fieldId}-status`} aria-label={`Status${platformSuffix}`}>
            <SelectValue placeholder="No status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unset">
              <span className="text-muted-foreground">No status</span>
            </SelectItem>
            <StatusSelectItems />
          </SelectContent>
        </Select>
      </Field>
      <Field label="Notes" htmlFor={`${fieldId}-notes`}>
        <Textarea
          id={`${fieldId}-notes`}
          value={currentNotes}
          onChange={(e) => onNotesChange?.(activeTab, e.target.value)}
          placeholder={showTabs ? `Notes for ${PLATFORM_LABELS[activeTab]}…` : "Notes…"}
          rows={3}
          className="leading-relaxed resize-none"
        />
      </Field>
      {/* No `htmlFor`: the control is a drop zone (or the image that replaced
          it), and the only element that could take an id is the hidden file
          input nobody can reach. An honest <span> rather than a label pointing
          at something invisible. */}
      <Field label="Screenshot">
        {currentScreenshot ? (
          <div className="relative group">
            <img
              src={currentScreenshot}
              alt={`Screenshot${platformSuffix}`}
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
      </Field>
    </>
  );

  if (!showTabs) {
    return <div className="flex flex-col gap-3">{fields}</div>;
  }

  return (
    // Radix rather than the `role="tablist"` div this replaces: the roles were
    // there, the WAI-ARIA keyboard contract behind them was not (audit
    // `shadcn-2`). `underline` is the strip's existing look, promoted into the
    // primitive so the two panel strips share one.
    <Tabs
      variant="underline"
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as PlatformId)}
      className="gap-3"
    >
      <TabsList>
        {/* PLATFORMS drives the order (web, iOS, Android); the effective set is
            a membership test, so the strip never reorders itself when the
            scope changes. */}
        {PLATFORMS.filter((p) => platforms.includes(p.id)).map((p) => {
          const PlatformIcon = PLATFORM_ICONS[p.id];

          return (
            <TabsTrigger key={p.id} value={p.id}>
              <PlatformIcon className="size-3.5" />
              {PLATFORM_LABELS[p.id]}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {/* One panel, always the selected one, rather than a `TabsContent` per
          platform: every tab edits the same three controls against `activeTab`,
          so a panel each would be three copies of identical markup — and
          switching tabs would remount the fields instead of re-pointing them. */}
      <TabsContent value={activeTab} className="flex flex-col gap-3">
        {fields}
      </TabsContent>
    </Tabs>
  );
}
