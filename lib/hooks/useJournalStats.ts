"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import type { JournalStats } from "@/lib/data/data-provider";
import { deriveLoadState, journalStatsQueryOptions } from "@/lib/data/project-queries";

/**
 * A project's journal aggregate — its size and each release's event count —
 * off its cached entry (`lib/data/project-queries.ts`). What the Overview reads
 * instead of the whole journal: on a hosted project that is
 * `GET …/journal/stats`, and the events themselves never cross the network.
 *
 * `stats` is `null` until the read lands, and stays `null` for a project that
 * does not exist — a caller tells those apart through `loading`.
 */
export function useJournalStats(projectId: string) {
  const result = useQuery(journalStatsQueryOptions(projectId));
  const stats: JournalStats | null = result.data?.stats ?? null;
  const { loading, error } = deriveLoadState(result, "Failed to load journal");

  const { refetch } = result;
  /** The retry behind every card's error state — joins a fetch already in flight. */
  const reload = useCallback(() => refetch({ cancelRefetch: false }).then(() => undefined), [refetch]);

  return { stats, loading, error, reload };
}
