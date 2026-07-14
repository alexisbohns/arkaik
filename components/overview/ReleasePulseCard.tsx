"use client";

import { TagIcon } from "lucide-react";
import { formatEventDate } from "@/components/journal/describe-event";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { PlatformId } from "@/lib/config/platforms";
import type { ReleasePulseEntry } from "@/lib/utils/coverage";
import { OverviewSection } from "./OverviewSection";

interface ReleasePulseCardProps {
  releases: ReleasePulseEntry[];
  projectId: string;
}

/** Every tagged release, newest first — the changelog's headline numbers. */
export function ReleasePulseCard({ releases, projectId }: ReleasePulseCardProps) {
  return (
    <OverviewSection title="Release pulse" href={`/project/${projectId}/changelog`} linkLabel="Changelog">
      {releases.length === 0 ? (
        <p className="text-sm text-muted-foreground">No releases tagged yet.</p>
      ) : (
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
