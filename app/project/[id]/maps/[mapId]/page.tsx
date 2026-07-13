"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { listMaps } from "@arkaik/schema";
import { JourneyMap } from "@/components/maps/JourneyMap";
import { SystemMap } from "@/components/maps/SystemMap";
import { Button } from "@/components/ui/button";
import { useProject } from "@/lib/hooks/useProject";

/**
 * Renderer shell: resolve the map id against the project's maps
 * (docs/spec/maps.md) and hand off to the kind's renderer. Unknown ids and
 * unrenderable kinds get an inline card, never an error.
 */
export default function ProjectMapPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";
  const mapIdParam = Array.isArray(params.mapId) ? params.mapId[0] : params.mapId ?? "";

  const { project: projectBundle, loading: projectLoading } = useProject(id);

  const definition = useMemo(() => {
    if (!projectBundle) return undefined;
    return listMaps(projectBundle.project).find((candidate) => candidate.id === mapIdParam);
  }, [mapIdParam, projectBundle]);

  if (projectLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading map...</span>
      </div>
    );
  }

  if (!definition) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6">
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">No map named &quot;{mapIdParam}&quot; in this project.</p>
          <Button asChild size="sm" className="mt-4 cursor-pointer">
            <Link href={`/project/${id}/maps`}>Browse maps</Link>
          </Button>
        </div>
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
      <div className="rounded-xl border border-dashed p-10 text-center">
        <p className="text-sm text-muted-foreground">
          &quot;{definition.title}&quot; has an unrecognized kind (&quot;{definition.kind}&quot;) — preserved, but this app version cannot render it.
        </p>
        <Button asChild size="sm" variant="outline" className="mt-4 cursor-pointer">
          <Link href={`/project/${id}/maps`}>Back to maps</Link>
        </Button>
      </div>
    </div>
  );
}
