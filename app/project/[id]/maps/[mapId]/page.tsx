"use client";

import Link from "next/link";
import { useMemo } from "react";
import { listMaps } from "@arkaik/schema";
import { JourneyMap } from "@/components/maps/JourneyMap";
import { SystemMap } from "@/components/maps/SystemMap";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useProject } from "@/lib/hooks/useProject";
import { useProjectId, useRouteParam } from "@/lib/hooks/useProjectId";

/**
 * Renderer shell: resolve the map id against the project's maps
 * (docs/spec/maps.md) and hand off to the kind's renderer. Unknown ids and
 * unrenderable kinds get an inline card, never an error.
 */
export default function ProjectMapPage() {
  const id = useProjectId();
  const mapIdParam = useRouteParam("mapId");

  const { project: projectBundle, loading: projectLoading, error: projectError, reload: reloadProject } = useProject(id);

  const definition = useMemo(() => {
    if (!projectBundle) return undefined;
    return listMaps(projectBundle.project).find((candidate) => candidate.id === mapIdParam);
  }, [mapIdParam, projectBundle]);

  if (projectLoading) {
    return <PageLoading label="map" />;
  }

  // Before the "no map named X" card, never after (#362): a failed project read
  // leaves `definition` undefined for every id, so a custom map the reader just
  // saved would be reported as not existing — and the card's advice ("Browse
  // maps") leads to a listing that failed the same read.
  if (projectError) {
    return <PageError label="map" message={projectError} onRetry={() => void reloadProject()} />;
  }

  if (!definition) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6">
        <EmptyState
          message={<>No map named &quot;{mapIdParam}&quot; in this project.</>}
          action={
            <Button asChild size="sm" className="cursor-pointer">
              <Link href={`/project/${id}/maps`}>Browse maps</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (definition.kind === "journey") {
    return <JourneyMap projectId={id} definition={definition} />;
  }

  if (definition.kind === "system") {
    return <SystemMap projectId={id} definition={definition} />;
  }

  return (
    <div className="h-full w-full flex items-center justify-center p-6">
      <EmptyState
        message={
          <>
            &quot;{definition.title}&quot; has an unrecognized kind (&quot;{definition.kind}&quot;) — preserved, but this app version cannot render it.
          </>
        }
        action={
          <Button asChild size="sm" variant="outline" className="cursor-pointer">
            <Link href={`/project/${id}/maps`}>Back to maps</Link>
          </Button>
        }
      />
    </div>
  );
}
