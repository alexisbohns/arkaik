"use client";

import { useEffect, useState } from "react";
import { getProvider } from "@/lib/data/provider-registry";
import type { ProjectBundle } from "@/lib/data/types";

export function useProjects() {
  const [projects, setProjects] = useState<ProjectBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getProvider()
      .listProjects()
      .then((nextProjects) => {
        if (cancelled) return;
        setProjects(nextProjects);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[useProjects] Failed to load projects:", err);
        setError(err instanceof Error ? err.message : "Failed to load projects");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { projects, loading, error };
}
