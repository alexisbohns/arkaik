"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Project, ProjectBundle } from "@/lib/data/types";
import { getProvider } from "@/lib/data/provider-registry";

export function useProject(id: string) {
  const [project, setProject] = useState<ProjectBundle | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Which load may write — see {@link useNodes} for why a token, not a flag. */
  const loadToken = useRef(0);

  /** The read — see {@link useNodes} for why the synchronous writes are not here. */
  const runLoad = useCallback(() => {
    const token = ++loadToken.current;
    return getProvider().getProject(id).then((p) => {
      if (loadToken.current !== token) return;
      setProject(p);
      setLoading(false);
    }).catch((err) => {
      if (loadToken.current !== token) return;
      console.error("[useProject] Failed to load project:", err);
      setError(err instanceof Error ? err.message : "Failed to load project");
      setLoading(false);
    });
  }, [id]);

  /** Re-run the read — the retry behind every `PageError` on a project surface. */
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    return runLoad();
  }, [runLoad]);

  useEffect(() => {
    void runLoad();
  }, [runLoad]);

  const updateProject = useCallback(
    async (patch: Partial<Omit<Project, "id" | "created_at">>) => {
      if (!project) {
        throw new Error("Cannot update project before it is loaded");
      }

      // Re-read the current bundle before saving. With the IndexedDB provider,
      // getProject returns a fresh snapshot, so this hook's `project` state does
      // not reflect node/edge edits made concurrently via useNodes/useEdges
      // (which the old shared-in-memory store surfaced automatically). Saving
      // our own stale `project.nodes`/`edges` would clobber those edits, so we
      // patch project-level fields onto the freshest stored bundle instead.
      const current = (await getProvider().getProject(project.project.id)) ?? project;

      const now = new Date().toISOString();
      const nextBundle: ProjectBundle = {
        ...current,
        project: {
          ...current.project,
          ...patch,
          updated_at: now,
        },
      };

      await getProvider().saveProject(nextBundle);
      setProject(nextBundle);
      return nextBundle.project;
    },
    [project],
  );

  return { project, loading, error, reload, updateProject };
}
