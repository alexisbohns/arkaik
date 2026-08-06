"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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

  /** Which load may write — see {@link useNodes} for why a token, not a flag. */
  const loadToken = useRef(0);

  /** The read — see {@link useNodes} for why the synchronous writes are not here. */
  const runLoad = useCallback(() => {
    const token = ++loadToken.current;
    return getProvider()
      .getJournal(projectId)
      .then((j) => {
        if (loadToken.current !== token) return;
        setJournal(j);
        setLoading(false);
      })
      .catch((err) => {
        if (loadToken.current !== token) return;
        console.error("[useJournal] Failed to load journal:", err);
        setError(err instanceof Error ? err.message : "Failed to load journal");
        setLoading(false);
      });
  }, [projectId]);

  /** Re-run the read — the retry behind every `PageError` on a project surface. */
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    return runLoad();
  }, [runLoad]);

  useEffect(() => {
    void runLoad();
  }, [runLoad]);

  return { journal, loading, error, reload };
}
