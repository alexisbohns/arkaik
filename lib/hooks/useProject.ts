"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  bundleKey,
  bundleQueryOptions,
  deriveLoadState,
  readProjectBundle,
  writeBackBundle,
  type BundleEntry,
} from "@/lib/data/project-queries";
import { getProvider } from "@/lib/data/provider-registry";
import type { Project, ProjectBundle } from "@/lib/data/types";

/**
 * The project bundle, off the one cached entry per project that `useNodes` and
 * `useEdges` share (`lib/data/project-queries.ts` owns the entry, the
 * freshness policy and every write). Same return shape as before the cache.
 */
export function useProject(id: string) {
  const client = useQueryClient();
  const result = useQuery(bundleQueryOptions(id));
  const project: ProjectBundle | undefined = result.data?.bundle;
  const { loading, error } = deriveLoadState(result, "Failed to load project");

  const { refetch } = result;
  /**
   * The retry behind every `PageError` on a project surface. Pages fan one
   * retry into several `reload()` calls on what is now one query, so each
   * joins the fetch already in flight instead of cancelling it.
   */
  const reload = useCallback(() => refetch({ cancelRefetch: false }).then(() => undefined), [refetch]);

  const updateProject = useCallback(
    async (patch: Partial<Omit<Project, "id" | "created_at">>) => {
      if (!project) {
        throw new Error("Cannot update project before it is loaded");
      }

      // A provider read, not the cached entry: the local and seed
      // `saveProject` rewrite nodes, edges and the journal from the bundle they
      // are given, so the bundle saved here must be what storage holds now —
      // never a copy a bypassing writer may have left behind. And not a cache
      // fetch either: a graph write-back's `cancelQueries` overlapping it (a
      // status click during a title autosave) would make `fetchQuery` resolve
      // with the REVERTED pre-mutation snapshot — query-core answers a
      // revert-cancel with `state.data` instead of rejecting — and that click
      // would then be saved away.
      //
      // Conditional where the backend allows it: the cached entry's validator
      // goes along, and a `not-modified` answer means the entry IS what the
      // server holds, so it is read straight off the cache at that moment —
      // a plain lookup, not a fetch, so the cancel trap above cannot bite.
      // The routing provider falls back to a plain read for local and seed,
      // which is the fresh read those backends require.
      const entry = client.getQueryData<BundleEntry | null>(bundleKey(id));
      const read = await readProjectBundle(getProvider(), id, { etag: entry?.etag ?? null });
      const current =
        read.status === "fresh"
          ? read.value
          : read.status === "not-modified"
            ? (client.getQueryData<BundleEntry | null>(bundleKey(id))?.bundle ?? project)
            : project;

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
      await writeBackBundle(client, id, nextBundle);
      return nextBundle.project;
    },
    [client, id, project],
  );

  return { project, loading, error, reload, updateProject };
}
