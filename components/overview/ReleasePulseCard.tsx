"use client";

import { TagIcon, TagsIcon } from "lucide-react";
import { formatEventDate } from "@/components/journal/describe-event";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { PlatformId } from "@/lib/config/platforms";
import type { ReleasePulseEntry } from "@/lib/utils/coverage";
import { OverviewSection } from "./OverviewSection";

interface ReleasePulseCardProps {
  releases: ReleasePulseEntry[];
  projectId: string;
  /**
   * The journal has not been read yet. The card keeps its empty layout with a
   * placeholder subtitle rather than claiming no release was ever tagged.
   */
  pending?: boolean;
  /**
   * The journal read failed. The message takes the subtitle's slot — the same
   * one the placeholder uses — so the card never says "No releases tagged
   * yet." over a journal it could not read. Of the four journal-backed cards
   * this is the first on the page, so it is the one that carries the retry.
   */
  error?: string | null;
  onRetry?: () => void;
}

/** Every tagged release, newest first — the changelog's headline numbers. */
export function ReleasePulseCard({
  releases,
  projectId,
  pending = false,
  error = null,
  onRetry,
}: ReleasePulseCardProps) {
  const unavailable = pending || error !== null;

  return (
    <OverviewSection
      title="Release pulse"
      icon={TagsIcon}
      description="How often this product ships, and what went out last."
      subtitle={
        pending ? (
          "…"
        ) : error !== null ? (
          <>
            {error}
            {onRetry && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={onRetry}
                  className="underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  Retry
                </button>
              </>
            )}
          </>
        ) : releases.length === 0 ? (
          "No releases tagged yet."
        ) : (
          `${releases.length} tagged release${releases.length === 1 ? "" : "s"}, newest first`
        )
      }
      href={`/project/${projectId}/changelog`}
      linkLabel="Changelog"
    >
      {!unavailable && releases.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {releases.map((release) => (
            <div key={release.eventId} className="flex items-center gap-2 text-sm">
              <TagIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">{release.version}</span>
              {release.platform && (
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  {PLATFORM_LABELS[release.platform as PlatformId] ?? release.platform}
                </span>
              )}
              <span className="flex-1" />
              <span className="text-xs text-muted-foreground">
                {release.eventCount} change{release.eventCount === 1 ? "" : "s"}
              </span>
              <span className="text-xs text-muted-foreground">{formatEventDate(release.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </OverviewSection>
  );
}
