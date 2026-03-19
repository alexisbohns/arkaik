"use client";

import { useState, useEffect } from "react";
import type { Project } from "@/lib/data/types";
import { localProvider } from "@/lib/data/local-provider";

export function useProject(id: string) {
  const [project, setProject] = useState<Project | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    localProvider.getProject(id).then((p) => {
      setProject(p);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [id]);

  return { project, loading };
}
