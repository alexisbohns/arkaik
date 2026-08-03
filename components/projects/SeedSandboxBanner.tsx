"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyIcon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { exportProject, importProjectFromFile } from "@/lib/utils/export";

/**
 * The sandbox banner shown across every page of the public self-map (self-map
 * cycle 4). Reset is a plain reload: the seed provider's state is per page
 * load, so a refresh IS the pristine reset — no bespoke reset path to drift.
 * "Import a copy" snapshots the tab's current sandbox state through the one
 * existing import funnel, which also regenerates the reserved id.
 */
export function SeedSandboxBanner({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);

  async function importCopy() {
    setImporting(true);
    try {
      const bundle = await exportProject(projectId);
      const file = new File([JSON.stringify(bundle)], "arkaik-self-map.json", {
        type: "application/json",
      });
      const project = await importProjectFromFile(file);
      toast.success(`"${project.title}" was copied to your projects.`);
      router.push(`/project/${project.id}`);
    } catch (err) {
      console.error("[SeedSandboxBanner] Failed to import a copy:", err);
      toast.error(err instanceof Error ? err.message : "Could not import a copy.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-muted/40 px-4 py-2">
      <p className="text-sm text-muted-foreground">
        You&apos;re exploring Arkaik&apos;s own map — a live sandbox. Changes stay in this tab and
        vanish on refresh.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="cursor-pointer"
          onClick={() => window.location.reload()}
        >
          <RotateCcwIcon />
          Reset
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="cursor-pointer"
          disabled={importing}
          onClick={() => void importCopy()}
        >
          <CopyIcon />
          {importing ? "Importing…" : "Import a copy"}
        </Button>
      </div>
    </div>
  );
}
