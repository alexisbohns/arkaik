"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

export function useGraphNavigation() {
  const router = useRouter();

  const navigateToProject = useCallback(
    (id: string) => {
      router.push(`/project/${id}`);
    },
    [router]
  );

  const navigateHome = useCallback(() => {
    router.push("/");
  }, [router]);

  return { navigateToProject, navigateHome };
}
