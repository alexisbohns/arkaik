"use client";

import { useId, useRef, useState, type CSSProperties } from "react";
import { ChevronDownIcon, ImagePlusIcon, Maximize2Icon, XIcon } from "lucide-react";
import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORMS } from "@/lib/config/platforms";
import { PLATFORM_ICONS, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { PlatformStatusMap } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import { platformAvailabilityShape } from "@/lib/utils/product-scope";
import { formatShotDate } from "@/lib/utils/screenshot-ops";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ExpressiveShape } from "@/components/arkademy/ExpressiveShape";
import { statusTone } from "@/components/panels/species-shape";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
/** The one form the URL field records; `decideScreenshot` checks it again server-side. */
const HTTPS_URL = /^https:\/\/\S+$/;

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
   * platform rows a surface shows is a *shape* decision, and shape decisions
   * belong to the scope — the same input the Acceptances matrix reads for its
   * status columns and the Pyramid for its rings. The per-node answer would
   * degrade to `node.platforms` whenever no product is declared, collapsing a
   * web-only view's deck in a project that has never heard of products.
   * `scopedPlatforms` is for per-node *facts*, like the chips in `PlatformList`.
   */
  platforms: PlatformId[];
  /** Platform opened on mount (e.g. the platform of the clicked Delivery item). */
  initialPlatform?: PlatformId;
  /** Absent on a read-only surface: the status then reads, it does not offer a choice. */
  onStatusChange?: (platform: PlatformId, value: StatusId | undefined) => void;
  /** Absent on a read-only surface: a note then reads as text, and no empty box is drawn. */
  onNotesChange?: (platform: PlatformId, value: string) => void;
  /**
   * Record a shot: the drop zone sends `form: "data"`, the URL field `form: "url"`.
   * Omitted on a read-only surface, and then the drop zone and URL field do not
   * render — a control that silently does nothing is worse than none.
   */
  onRecordScreenshot?: (platform: PlatformId, form: "url" | "data", value: string) => void;
  /** Omitted on a read-only surface, and then the Remove button does not render. */
  onRemoveScreenshot?: (platform: PlatformId) => void;
  /** Provenance of the current shot per platform, for the caption. */
  screenshotMeta?: Partial<Record<PlatformId, { ts?: string; source?: "ci" | "manual"; form?: string }>>;
  /** Per platform: the journal says the node moved after this shot. */
  stale?: Partial<Record<PlatformId, boolean>>;
  /**
   * A screenshot op is in flight: every control holds, because a status or
   * notes patch built now would carry the pre-op slot into `update_node`.
   */
  busy?: boolean;
  onZoomShot?: (platform: PlatformId) => void;
}

/**
 * The per-platform editor — a **status deck**: one tile per platform, every
 * platform's status in reach at once, one tile open for its screenshot and
 * notes.
 *
 * It replaced a tab strip over a single status select, which answered "is iOS
 * done?" only after a click. The deck answers it for every platform in one
 * look and keeps the heavy part (a screenshot, a note) to the one platform
 * being worked on. The open tile is a soft neutral step, not a species tint:
 * it marks where you are, it is not something to notice.
 *
 * **The arity rule decides whether there is a deck at all**, read off
 * `platformAvailabilityShape` so this cannot drift from the Pyramid's rings or
 * the Acceptances matrix's status columns: two or more platforms in the scope's
 * menu get a tile each, one or zero get a single unlabelled status and no
 * platform chrome — the same collapse, on a third surface.
 *
 * **It opens on the platform you came for**: `initialPlatform` when the surface
 * says so, otherwise the first platform holding a screenshot, so a view never
 * lands on an empty drop zone while its other platforms have shots.
 *
 * **Per-platform notes, statuses, and screenshots for a platform outside the
 * menu are neither rendered nor deleted.** They sit untouched in `metadata`,
 * and every handler patches by spreading the stored map, so a node edited under
 * a web-only scope round-trips its iOS note intact.
 */
export function PlatformVariants({
  statuses = {},
  notes = {},
  screenshots = {},
  platforms,
  initialPlatform,
  onStatusChange,
  onNotesChange,
  onRecordScreenshot,
  onRemoveScreenshot,
  screenshotMeta,
  stale,
  busy = false,
  onZoomShot,
}: PlatformVariantsProps) {
  const multi = platformAvailabilityShape(platforms) === "rings";
  const [selected, setSelected] = useState<PlatformId>(() => {
    if (initialPlatform && platforms.includes(initialPlatform)) return initialPlatform;
    return platforms.find((platform) => screenshots[platform]) ?? platforms[0] ?? PLATFORMS[0].id;
  });
  // Derived rather than synced by an effect: the scope can change under a
  // mounted panel, and a selection left pointing at a platform that just left
  // the menu would edit a field nothing renders.
  const active = platforms.includes(selected) ? selected : platforms[0] ?? PLATFORMS[0].id;
  const [dragOver, setDragOver] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Per-mount: the panel stack keeps hidden panels mounted, so two of these
  // editors can share a document and a hand-written id would collide.
  const fieldId = useId();
  const urlDraftValid = HTTPS_URL.test(urlDraft.trim());
  const shown = PLATFORMS.filter((platform) => platforms.includes(platform.id)).map((platform) => platform.id);

  // No platform name at arity ≤ 1: the scope selector already says "Admin — Web
  // only", so repeating it on every label is chrome that earns nothing.
  const suffix = (platform: PlatformId) => (multi ? ` for ${PLATFORM_LABELS[platform]}` : "");

  async function handleFile(file: File) {
    // A file dialog opened before an op started and confirmed during it would
    // otherwise fire a second op.
    if (busy) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_FILE_SIZE) return;
    const dataUrl = await readFileAsDataUrl(file);
    onRecordScreenshot?.(active, "data", dataUrl);
  }

  function statusSelect(platform: PlatformId, compact: boolean) {
    const current = statuses[platform];
    return (
      <Select
        value={current ?? ""}
        disabled={busy || !onStatusChange}
        onValueChange={(value) => onStatusChange?.(platform, value === "unset" ? undefined : (value as StatusId))}
      >
        <SelectTrigger
          id={`${fieldId}-${platform}-status`}
          aria-label={`Status${suffix(platform)}`}
          data-np-status
          data-compact={compact || undefined}
          data-empty={!current || undefined}
          style={{ "--np-status-tone": statusTone(current) } as CSSProperties}
          className="w-auto"
        >
          <SelectValue placeholder="No status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unset">
            <span className="text-muted-foreground">No status</span>
          </SelectItem>
          <StatusSelectItems />
        </SelectContent>
      </Select>
    );
  }

  function caption(platform: PlatformId) {
    const meta = screenshotMeta?.[platform];
    // Guarded: `ts` crosses a surface boundary and a malformed one renders
    // "Invalid Date" unless checked.
    const date = meta?.ts ? formatShotDate(meta.ts) : undefined;
    const source = meta?.source === "ci" ? "From CI" : meta?.source === "manual" ? "Recorded by hand" : "Legacy shot";
    return (
      <span className="np-pv-caption" data-stale={stale?.[platform] === true || undefined}>
        {source}
        {date ? ` · ${date}` : ""}
        {stale?.[platform] === true ? " · may be stale" : ""}
      </span>
    );
  }

  function screenshot(platform: PlatformId) {
    const shot = screenshots[platform];
    return shot ? (
      <figure className="np-pv-shot" data-size="compact">
        {/* The zoom is a real button when the surface can zoom; otherwise a plain image. */}
        {onZoomShot ? (
          <button
            type="button"
            className="np-pv-shot-frame"
            onClick={() => onZoomShot(platform)}
            aria-label={`Open the screenshot${suffix(platform)} larger`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot} alt={`Screenshot${suffix(platform)}`} />
            <span className="np-pv-zoom" aria-hidden="true">
              <Maximize2Icon className="size-4" />
            </span>
          </button>
        ) : (
          <span className="np-pv-shot-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot} alt={`Screenshot${suffix(platform)}`} />
          </span>
        )}
        {onRemoveScreenshot && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="np-pv-remove"
            aria-label="Remove screenshot"
            disabled={busy}
            onClick={() => onRemoveScreenshot(platform)}
          >
            <XIcon className="size-4" />
          </Button>
        )}
        <figcaption>{caption(platform)}</figcaption>
      </figure>
    ) : !onRecordScreenshot ? (
      <p className="np-pv-noshot">No screenshot</p>
    ) : (
      <div className="np-pv-record" data-size="compact">
        <div
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-disabled={busy || undefined}
          aria-label={`Upload a screenshot${suffix(platform)}`}
          data-drag={dragOver || undefined}
          className="np-pv-drop"
          onClick={() => {
            if (!busy) fileInputRef.current?.click();
          }}
          onKeyDown={(event) => {
            if (busy) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            if (busy) return;
            const file = event.dataTransfer.files[0];
            if (file) void handleFile(file);
          }}
        >
          <span className="np-pv-drop-badge" aria-hidden="true">
            <ExpressiveShape shape="cookie12" className="np-pv-drop-shape" />
            <ImagePlusIcon className="np-pv-drop-icon" />
          </span>
          <span className="np-pv-drop-text">
            <span className="np-pv-drop-title">Drop a screenshot</span>
            <span className="np-pv-drop-sub">or click to upload · 2 MB max</span>
          </span>
        </div>
        <form
          className="np-pv-url"
          onSubmit={(event) => {
            event.preventDefault();
            const value = urlDraft.trim();
            if (!HTTPS_URL.test(value)) return;
            onRecordScreenshot(platform, "url", value);
            setUrlDraft("");
          }}
        >
          <input
            id={`${fieldId}-${platform}-shot-url`}
            aria-label={`Screenshot URL${suffix(platform)}`}
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            placeholder="or paste https://…/screenshot.png"
            disabled={busy}
          />
          <button type="submit" title="https:// URLs only" disabled={busy || !urlDraftValid}>
            Record
          </button>
        </form>
      </div>
    );
  }

  function notesField(platform: PlatformId) {
    // Read-only: a note is a fact worth showing; an empty box is a dead control.
    if (!onNotesChange) {
      const note = (notes[platform] ?? "").trim();
      return note ? <p className="np-pv-notes-read">{note}</p> : null;
    }
    return (
      <div className="np-pv-notes">
        <label htmlFor={`${fieldId}-${platform}-notes`} className="sr-only">
          Notes{suffix(platform)}
        </label>
        <Textarea
          id={`${fieldId}-${platform}-notes`}
          value={notes[platform] ?? ""}
          onChange={(event) => onNotesChange(platform, event.target.value)}
          placeholder={multi ? `Notes for ${PLATFORM_LABELS[platform]}…` : "Notes…"}
          rows={2}
          disabled={busy}
        />
      </div>
    );
  }

  const fileInput = onRecordScreenshot && (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void handleFile(file);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }}
    />
  );

  return (
    <div className="np-deck" data-single={!multi || undefined}>
      {multi ? (
        shown.map((platform) => {
          const Icon = PLATFORM_ICONS[platform];
          const open = platform === active;
          const shot = screenshots[platform];
          const note = (notes[platform] ?? "").trim();
          return (
            <div key={platform} className="np-deck-tile" data-open={open || undefined}>
              <div className="np-deck-row">
                <button
                  type="button"
                  className="np-deck-toggle"
                  aria-expanded={open}
                  aria-controls={`${fieldId}-${platform}-body`}
                  onClick={() => setSelected(platform)}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="np-deck-name">{PLATFORM_LABELS[platform]}</span>
                  {/* What a shut tile holds, so a reader knows which one to open. */}
                  {!open && (shot || note) && (
                    <span className="np-deck-peek">
                      {[shot && "Screenshot", note && "Notes"].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  <ChevronDownIcon className="np-deck-chevron size-4 shrink-0" aria-hidden="true" />
                </button>
                {statusSelect(platform, true)}
              </div>
              {open && (
                <div id={`${fieldId}-${platform}-body`} className="np-deck-body">
                  {screenshot(platform)}
                  {notesField(platform)}
                </div>
              )}
            </div>
          );
        })
      ) : (
        <div className="np-deck-tile" data-open>
          <div className="np-deck-row">
            <span className="np-deck-name">Status</span>
            {statusSelect(active, false)}
          </div>
          <div className="np-deck-body">
            {screenshot(active)}
            {notesField(active)}
          </div>
        </div>
      )}
      {fileInput}
    </div>
  );
}
