"use client";

import { useState, useEffect, useCallback } from "react";
import type { Project, ProjectBundle } from "@/lib/data/types";
import { localProvider } from "@/lib/data/local-provider";

export function useProject(id: string) {
  const [project, setProject] = useState<ProjectBundle | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localProvider.getProject(id).then((p) => {
      setProject(p);
      setLoading(false);
    }).catch((err) => {
      console.error("[useProject] Failed to load project:", err);
      setError(err instanceof Error ? err.message : "Failed to load project");
      setLoading(false);
    });
  }, [id]);

  const updateProject = useCallback(
    async (patch: Partial<Omit<Project, "id" | "created_at">>) => {
      if (!project) {
        throw new Error("Cannot update project before it is loaded");
      }

      const now = new Date().toISOString();
      const nextBundle: ProjectBundle = {
        ...project,
        project: {
          ...project.project,
          ...patch,
          updated_at: now,
        },
      };

      await localProvider.saveProject(nextBundle);
      setProject(nextBundle);
      return nextBundle.project;
    },
    [project],
  );

  return { project, loading, error, updateProject };
}
