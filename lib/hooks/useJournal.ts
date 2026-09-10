"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import { deriveLoadState, EMPTY_JOURNAL, journalQueryOptions } from "@/lib/data/project-queries";
import type { JournalEvent } from "@/lib/data/types";

/**
 * A project's embedded `journal[]`, off its cached journal entry
 * (`lib/data/project-queries.ts`; the whole journal today — typed projections
 * arrive with the `?types=` read). Read-only by design: the events a write
 * appends reach this entry through the hooks' write-back, not through a
 * mutator here. The browser app consumes only the embedded journal; the repo
 * `.jsonl` sidecar is a CLI concern (docs/spec/journal.md § Storage Shapes).
 */
export function useJournal(projectId: string) {
  const result = useQuery(journalQueryOptions(projectId, null));
  const journal: JournalEvent[] = result.data?.events ?? EMPTY_JOURNAL;
  const { loading, error } = deriveLoadState(result, "Failed to load journal");

  const { refetch } = result;
  /** The retry behind every `PageError` — joins a fetch already in flight. */
  const reload = useCallback(() => refetch({ cancelRefetch: false }).then(() => undefined), [refetch]);

  return { journal, loading, error, reload };
}
