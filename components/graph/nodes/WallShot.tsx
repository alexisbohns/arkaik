"use client";

import { memo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useStore } from "@xyflow/react";
import {
  BanIcon,
  CircleDashedIcon,
  ClockIcon,
  FolderOpenIcon,
  FolderTreeIcon,
  ImageOffIcon,
  type LucideIcon,
} from "lucide-react";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformCell, ShotState, WallShot as WallShotValue } from "@/lib/utils/screen-wall";
import { DEFAULT_ASPECT, LOD_ZOOM, clampAspect } from "@/lib/utils/screen-wall-layout";
import { cn } from "@/lib/utils";
import { hasShotFailed, reportShotFailure, shotKey, subscribeShotFailures } from "@/components/maps/screens/aspect-cache";
import { PLATFORM_ICONS, PLATFORM_LABELS, STATUS_ICONS, STATUS_LABELS, STATUS_STYLES } from "./node-styles";
import type { AspectReport } from "./wall-node-data";

/** The ghost's faint hatch: `currentColor`, drawn at 10% by the layer that carries it. */
const HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 8px)",
};

/**
 * Whether the camera is close enough to draw images and captions. A boolean
 * selector, so a frame re-renders only when the zoom crosses `LOD_ZOOM`, never
 * on every wheel step.
 */
export function useWallDetail(): boolean {
  return useStore((state) => state.transform[2] >= LOD_ZOOM);
}

interface Ghost {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  detail: string | null;
  /** `absent`: solid light border, no hatch. `gap`: dashed amber (a live screen with no shot). */
  tone: "plain" | "gap" | "absent";
}

function hostOf(shot: WallShotValue): string {
  if (shot.form === "data") return "An inline image";
  try {
    return new URL(shot.value).host;
  } catch {
    return shot.value;
  }
}

function absentGhost(platform: PlatformId): Ghost {
  return {
    icon: PLATFORM_ICONS[platform],
    iconClass: "text-muted-foreground",
    title: `Not on ${PLATFORM_LABELS[platform]}`,
    detail: null,
    tone: "absent",
  };
}

/**
 * What a frame says when it cannot show a picture — the spec's ghost column,
 * word for word — or null when there is a picture to show.
 */
function ghostFor(cell: PlatformCell | undefined, platform: PlatformId, failed: boolean): Ghost | null {
  const label = PLATFORM_LABELS[platform];
  if (!cell || cell.state === "absent") return absentGhost(platform);
  const shot = cell.shot;
  if (shot && shot.form === "path") {
    return {
      icon: FolderTreeIcon,
      iconClass: "text-muted-foreground",
      title: "Shot in the repo",
      detail: "Paths open from the bundle's folder, not in the app",
      tone: "plain",
    };
  }
  if (shot && failed) {
    return { icon: ImageOffIcon, iconClass: "text-muted-foreground", title: "Shot didn't load", detail: hostOf(shot), tone: "plain" };
  }
  if (shot) return null;
  if (cell.state === "live-no-shot") {
    return {
      icon: ImageOffIcon,
      iconClass: "text-amber-500 dark:text-amber-400",
      title: "No shot yet",
      detail: `Live on ${label}`,
      tone: "gap",
    };
  }
  if (cell.status === null) {
    return {
      icon: CircleDashedIcon,
      iconClass: "text-muted-foreground",
      title: "No status",
      detail: `Nothing says where this stands on ${label}`,
      tone: "plain",
    };
  }
  return {
    icon: STATUS_ICONS[cell.status],
    iconClass: STATUS_STYLES[cell.status].badge,
    title: STATUS_LABELS[cell.status],
    detail: `Not live on ${label} yet`,
    tone: "plain",
  };
}

interface WallShotProps {
  viewId: string;
  platform: PlatformId;
  /** Undefined when the platform is outside the wall's menu: drawn as absent. */
  cell: PlatformCell | undefined;
  width: number;
  height: number;
  onAspect: AspectReport;
}

/**
 * One platform's picture inside a frame: the screenshot, or a ghost that says
 * why there is none. The image is decorative (`alt=""`) — the frame's
 * `aria-label` carries the meaning — and is only ever mounted while the frame
 * is on screen (`onlyRenderVisibleElements`) and the camera is above
 * `LOD_ZOOM`; below it the box keeps the state's tint and glyph. A path is
 * never requested: it resolves against the page's own URL and would 404.
 */
export function WallShot({ viewId, platform, cell, width, height, onAspect }: WallShotProps) {
  const detailed = useWallDetail();
  const shot = cell?.shot ?? null;
  // The shot's fingerprint: what its measured shape and its failure are kept
  // under, tab-wide (aspect-cache). A new shot in the slot is a new key, so it
  // gets a fresh try; a failed one shows its ghost as soon as the frame comes
  // back on screen, without requesting the image again.
  const key = shot === null ? null : shotKey(shot);
  const failed = useSyncExternalStore(
    subscribeShotFailures,
    () => key !== null && hasShotFailed(viewId, platform, key),
    () => false,
  );
  const ghost = ghostFor(cell, platform, failed);

  if (ghost !== null || shot === null || cell === undefined) {
    const shown = ghost ?? absentGhost(platform);
    const Icon = shown.icon;
    return (
      <div
        className={cn(
          "relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-md px-3 text-center",
          shown.tone === "absent" && "border border-border/60 bg-muted/20",
          shown.tone === "plain" && "border-2 border-dashed border-border bg-card",
          shown.tone === "gap" && "border-2 border-dashed border-amber-500 bg-card dark:border-amber-400",
        )}
        style={{ width, height }}
      >
        {shown.tone !== "absent" && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 text-foreground opacity-10" style={HATCH} />
        )}
        <Icon className={cn("relative size-5 shrink-0", shown.iconClass)} aria-hidden="true" />
        {detailed && (
          <>
            <span className="relative text-xs font-medium leading-tight">{shown.title}</span>
            {shown.detail && (
              <span className="relative line-clamp-3 text-[11px] leading-snug text-muted-foreground">{shown.detail}</span>
            )}
          </>
        )}
      </div>
    );
  }

  const stale = cell.state === "live-stale";
  const notLive = cell.state === "not-live";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-border bg-muted",
        stale && "ring-2 ring-amber-500 ring-offset-2 ring-offset-card dark:ring-amber-400",
      )}
      style={{ width, height }}
    >
      {detailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- an arbitrary data: or absolute-URL screenshot, not an optimisable asset
        <img
          src={shot.value}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          data-wall-shot=""
          className={cn("h-full w-full object-cover object-top", notLive && "opacity-50")}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              onAspect(viewId, platform, shotKey(shot), image.naturalWidth / image.naturalHeight);
            }
          }}
          onError={() => reportShotFailure(viewId, platform, shotKey(shot))}
        />
      ) : (
        <div
          aria-hidden="true"
          className={cn(
            "h-full w-full",
            stale ? "bg-amber-500/10" : notLive ? "bg-muted" : STATUS_STYLES.live.surface,
          )}
        />
      )}
      {detailed && stale && (
        <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white dark:bg-amber-400 dark:text-black">
          <ClockIcon className="size-3" aria-hidden="true" />
          Stale
        </span>
      )}
      {detailed && notLive && (
        <span className="absolute top-1.5 left-1.5 rounded-full border bg-card px-2 py-0.5 text-[10px] font-semibold">
          {cell.status === null ? "No status" : STATUS_LABELS[cell.status]}
        </span>
      )}
    </div>
  );
}

/** The mini ghost's hatch: `currentColor` stripes, drawn at 10% by the span that carries it. */
const MINI_HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 6px)",
};

type MiniGhost = "absent" | "no-shot" | "not-live" | "path" | "error";

function miniGhostOf(state: ShotState, shot: WallShotValue | null): MiniGhost {
  if (state === "absent") return "absent";
  if (shot !== null) return shot.form === "path" ? "path" : "error";
  return state === "live-no-shot" ? "no-shot" : "not-live";
}

/** The ghost's glyph; a component, so the icon is chosen in JSX rather than created during render. */
function MiniGhostGlyph({ ghost, status }: { ghost: MiniGhost; status: StatusId | null }) {
  const className = "relative size-3.5";
  switch (ghost) {
    case "absent":
      return <BanIcon aria-hidden className={className} />;
    case "path":
      return <FolderOpenIcon aria-hidden className={className} />;
    case "error":
      return <ImageOffIcon aria-hidden className={className} />;
    case "no-shot":
      return <CircleDashedIcon aria-hidden className={className} />;
    case "not-live": {
      if (status === null) return <CircleDashedIcon aria-hidden className={className} />;
      const StatusIcon = STATUS_ICONS[status];
      return <StatusIcon aria-hidden className={className} />;
    }
  }
}

function miniGhostClass(ghost: MiniGhost, status: StatusId | null): string {
  switch (ghost) {
    case "absent":
      return "border-border/60 text-muted-foreground";
    case "no-shot":
      return "border-dashed border-amber-500 text-amber-700 dark:border-amber-400 dark:text-amber-400";
    case "not-live":
      return cn("border-dashed border-border", status === null ? "text-muted-foreground" : STATUS_STYLES[status].badge);
    case "path":
    case "error":
      return "border-dashed border-border text-muted-foreground";
  }
}

export interface WallMiniShotProps {
  viewId: string;
  platform: PlatformId;
  /** The row's cell; undefined reads as absent. */
  cell: PlatformCell | undefined;
  /** The row height (`sideGeometry`'s `rowHeight`). */
  height: number;
  /** The mini column's width; no mini is drawn wider. */
  maxWidth: number;
  onAspect: AspectReport;
}

/**
 * One platform's picture in a side-by-side frame (spec § Layout, § Images).
 *
 * Width = row height × the shot's own aspect once it has loaded (clamped, as
 * `sideGeometry` does), the platform default before that and for ghosts. The
 * column was sized by the layout from the same measured aspect (through the
 * aspect cache), so a loaded mini fits it; `maxWidth` only guards the frame
 * between the load and the relayout. The state word sits beside the mini, so a
 * ghost here carries no text: only its border, hatch and glyph. Below
 * `LOD_ZOOM` (`useWallDetail`) the image and the glyph drop, like a full shot.
 *
 * The measured ratio is keyed by the shot's fingerprint (aspect-cache
 * `shotKey`) and compared during render, never reset in an effect, so a new
 * shot starts clean; a load failure is remembered tab-wide in the aspect
 * cache, like a full shot's, so a mini that scrolls back shows its ghost
 * without requesting the image again.
 */
export const WallMiniShot = memo(function WallMiniShot({
  viewId,
  platform,
  cell,
  height,
  maxWidth,
  onAspect,
}: WallMiniShotProps) {
  const detailed = useWallDetail();
  const [measured, setMeasured] = useState<{ key: string; ratio: number } | null>(null);

  const state: ShotState = cell?.state ?? "absent";
  const status = cell?.status ?? null;
  const shot = state === "absent" ? null : (cell?.shot ?? null);
  const key = shot === null ? null : shotKey(shot);
  const failed = useSyncExternalStore(
    subscribeShotFailures,
    () => key !== null && hasShotFailed(viewId, platform, key),
    () => false,
  );
  const ratio = key !== null && measured?.key === key ? measured.ratio : null;
  const aspect = ratio === null ? DEFAULT_ASPECT[platform] : clampAspect(ratio);
  const width = Math.max(1, Math.min(maxWidth, Math.round(height * aspect)));

  if (shot !== null && shot.form !== "path" && !failed) {
    return (
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-sm bg-muted",
          state === "live-stale" && "ring-2 ring-amber-500 dark:ring-amber-400",
          state === "not-live" && "opacity-50",
        )}
        style={{ width, height }}
        data-mini="shot"
      >
        {detailed && (
          // eslint-disable-next-line @next/next/no-img-element -- an arbitrary data:/https: shot; next/image has nothing to optimise
          <img
            src={shot.value}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            referrerPolicy="no-referrer"
            data-wall-shot=""
            className="size-full object-cover object-top"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth <= 0 || naturalHeight <= 0) return;
              const next = naturalWidth / naturalHeight;
              setMeasured({ key: shotKey(shot), ratio: next });
              onAspect(viewId, platform, shotKey(shot), next);
            }}
            onError={() => reportShotFailure(viewId, platform, shotKey(shot))}
          />
        )}
      </div>
    );
  }

  const ghost = miniGhostOf(state, shot);
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-sm border",
        miniGhostClass(ghost, status),
      )}
      style={{ width, height }}
      data-mini={ghost}
    >
      {ghost !== "absent" && (
        <span aria-hidden className="pointer-events-none absolute inset-0 opacity-10" style={MINI_HATCH} />
      )}
      {detailed && <MiniGhostGlyph ghost={ghost} status={status} />}
    </div>
  );
});
