"use client";

import { useCallback, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { JournalFamilyId } from "@arkaik/schema";

import { deriveLoadState, journalPagesQueryOptions } from "@/lib/data/project-queries";
import type { JournalEvent } from "@/lib/data/types";

/**
 * A project's journal newest first, a page at a time — the History page's
 * read (`lib/data/project-queries.ts`). `families` narrows it to the History
 * chips' type prefixes on the backend, so a filtered view pages through its
 * own events rather than filtering one page of everything.
 *
 * `events` is every loaded page, flattened. `loadMore` asks for the next one;
 * `hasMore` says whether there is one. `loading` and `error` describe the
 * FIRST page only — a failed "load more" leaves the pages already shown in
 * place, and reports through `loadMoreError` instead.
 */
export function useJournalPages(projectId: string, families: readonly JournalFamilyId[] | null) {
  const result = useInfiniteQuery(journalPagesQueryOptions(projectId, families));
  const { data, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, refetch } = result;

  const events = useMemo<JournalEvent[]>(
    () => (data ? data.pages.flatMap((page) => page.events as JournalEvent[]) : []),
    [data],
  );
  const { loading, error } = deriveLoadState(result, "Failed to load journal");

  const loadMore = useCallback(() => fetchNextPage({ cancelRefetch: false }).then(() => undefined), [fetchNextPage]);
  /** The retry behind the page's error state — joins a fetch already in flight. */
  const reload = useCallback(() => refetch({ cancelRefetch: false }).then(() => undefined), [refetch]);

  return {
    events,
    loading,
    error,
    reload,
    hasMore: hasNextPage,
    loadMore,
    loadingMore: isFetchingNextPage,
    loadMoreError: isFetchNextPageError ? "Could not load more history." : null,
  };
}
