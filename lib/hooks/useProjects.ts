"use client";

import { useEffect, useState } from "react";
import { localProvider } from "@/lib/data/local-provider";
import type { ProjectBundle } from "@/lib/data/types";

export function useProjects() {
  const [projects, setProjects] = useState<ProjectBundle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    localProvider
      .listProjects()
      .then((nextProjects) => {
        if (cancelled) return;
        setProjects(nextProjects);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { projects, loading };
}