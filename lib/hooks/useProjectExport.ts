"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { downloadJson, exportProject } from "@/lib/utils/export";

/**
 * Export the project bundle to a file. Lives here rather than on a map, because
 * it exports the project — the Journey canvas was only ever where the button
 * happened to sit.
 *
 * Outcomes go to toasts rather than to caller-rendered state: the trigger is a
 * dropdown item that closes on click, so anything rendered next to it would be
 * unmounted before the export resolved, and a failure would report nothing.
 */
export function useProjectExport(projectId: string) {
  const [exporting, setExporting] = useState(false);

  const exportBundle = useCallback(async () => {
    if (!projectId) {
      toast.error("Unable to export: missing project id.");
      return;
    }

    // Guarded here rather than at each call site, so the keyboard shortcut
    // cannot start a second export on top of the one a click already started.
    if (exporting) return;

    setExporting(true);
    try {
      const bundle = await exportProject(projectId);
      const result = downloadJson(bundle);
      toast.success(`Exported ${result.filename}.`);
      if (result.warning) toast.warning(result.warning);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown export error";
      toast.error(`Unable to export project: ${message}`);
    } finally {
      setExporting(false);
    }
  }, [exporting, projectId]);

  return { exportBundle, exporting };
}
