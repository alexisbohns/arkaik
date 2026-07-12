"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { importProjectFromFile } from "@/lib/utils/export";

interface ImportSnapshotButtonProps {
  snapshotId: string;
  /** Used only as the synthetic `File` name handed to the import funnel. */
  suggestedFileName: string;
}

/**
 * The "Import into arkaik" action on `/p/{id}` (docs/spec/services.md § Publik
 * → Surfaces). Fetches the snapshot JSON client-side, then funnels it through
 * the same `importProjectFromFile` path the manual JSON import uses
 * (`app/projects/page.tsx`) — validation, timestamp repair, and ID-collision
 * rewriting come for free — before redirecting to the imported project's canvas.
 */
export function ImportSnapshotButton({ snapshotId, suggestedFileName }: ImportSnapshotButtonProps) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);

  async function handleImport() {
    setImporting(true);
    try {
      const res = await fetch(`/api/publik/${encodeURIComponent(snapshotId)}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          toast.error("This snapshot is no longer available.");
        } else {
          toast.error(`Unable to load snapshot (HTTP ${res.status}).`);
        }
        return;
      }

      const text = await res.text();
      const file = new File([text], suggestedFileName, { type: "application/json" });
      const project = await importProjectFromFile(file);
      toast.success(`Imported "${project.title}" into arkaik.`);
      router.push(`/project/${project.id}/canvas`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown import error";
      toast.error(`Import failed: ${message}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Button size="lg" className="cursor-pointer" onClick={() => void handleImport()} disabled={importing}>
      {importing ? <Loader2Icon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
      {importing ? "Importing..." : "Import into arkaik"}
    </Button>
  );
}
