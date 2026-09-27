"use client";

import { useQuery } from "@tanstack/react-query";

import type { ProjectSummary } from "@/lib/data/data-provider";
import { deriveLoadState, EMPTY_PROJECTS, projectsQueryOptions } from "@/lib/data/project-queries";

/**
 * The active `ProjectSummary[]` for the shell, off the cached listing
 * (`lib/data/project-queries.ts`). Fresh for a minute; every writer that
 * changes the listing marks it stale for its next mount.
 */
export function useProjects() {
  const result = useQuery(projectsQueryOptions());
  const projects: ProjectSummary[] = result.data ?? EMPTY_PROJECTS;
  const { loading, error } = deriveLoadState(result, "Failed to load projects");

  return { projects, loading, error };
}
