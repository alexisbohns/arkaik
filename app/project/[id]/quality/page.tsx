"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageLoading } from "@/components/layout/PageLoading";
import { useProjectId } from "@/lib/hooks/useProjectId";

/**
 * `/quality` is no longer a page — it is the section's front door.
 *
 * Quality split into a Matrix page and a Findings page, and every link ever
 * shared, bookmarked or written into a journal entry points here. The redirect
 * carries the whole query string across, so a `?cell=`, a `?criterion=` or a
 * `?node=` that arrived on this URL still lands on a page that knows what to do
 * with it.
 *
 * `replace`, not `push`: a redirect the reader never chose must not become a
 * step Back has to climb out of.
 */
export default function ProjectQualityPage() {
  const id = useProjectId();
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    router.replace(`/project/${id}/quality/matrix${query === "" ? "" : `?${query}`}`);
  }, [id, query, router]);

  return <PageLoading label="quality" />;
}
