"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import { deriveLoadState, EMPTY_JOURNAL, journalQueryOptions } from "@/lib/data/project-queries";
import type { JournalEvent } from "@/lib/data/types";

/**
 * A project's embedded `journal[]`, off its cached journal entry
 * (`lib/data/project-queries.ts`). Read-only by design: the events a write
 * appends reach this entry through the hooks' write-back, not through a
 * mutator here. The browser app consumes only the embedded journal; the repo
 * `.jsonl` sidecar is a CLI concern (docs/spec/journal.md § Storage Shapes).
 *
 * `types` PROJECTS the read: a page that renders three event types asks for
 * those three, and on a hosted project the rest never cross the network. Each
 * projection is its own cache entry, keyed on the normalized list, so two
 * callers asking for the same types in a different order share one read and
 * one entry. Omit it — or pass `[]` — for the whole journal, which is what
 * the Overview's counts and the History page need.
 *
 * A page must only project types it can render a truthful empty state for:
 * "no releases yet" has to stay true when the read that would have contradicted
 * it was never made.
 */
export function useJournal(projectId: string, options?: { types?: readonly string[] | null }) {
  const result = useQuery(journalQueryOptions(projectId, options?.types ?? null));
  const journal: JournalEvent[] = result.data?.events ?? EMPTY_JOURNAL;
  const { loading, error } = deriveLoadState(result, "Failed to load journal");

  const { refetch } = result;
  /** The retry behind every `PageError` — joins a fetch already in flight. */
  const reload = useCallback(() => refetch({ cancelRefetch: false }).then(() => undefined), [refetch]);

  return { journal, loading, error, reload };
}
