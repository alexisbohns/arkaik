"use client";

import { useState, useEffect } from "react";
import type { JournalEvent } from "@/lib/data/types";
import { getProvider } from "@/lib/data/provider-registry";

/**
 * Loads a project's embedded `journal[]` — consistent with {@link useNodes} /
 * {@link useEdges}. Read-only by design: app-side event emission is M3, so this
 * hook exposes the events and load state, not mutators. The browser app
 * consumes only the embedded journal; the repo `.jsonl` sidecar is a CLI
 * concern (docs/spec/journal.md § Storage Shapes).
 */
export function useJournal(projectId: string) {
  const [journal, setJournal] = useState<JournalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProvider()
      .getJournal(projectId)
      .then((j) => {
        setJournal(j);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[useJournal] Failed to load journal:", err);
        setError(err instanceof Error ? err.message : "Failed to load journal");
        setLoading(false);
      });
  }, [projectId]);

  return { journal, loading, error };
}
