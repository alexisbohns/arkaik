"use client";

import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useStoredDraftText } from "@/lib/hooks/useCanvasDraft";
import { downloadTextFile } from "@/lib/utils/download";

/**
 * Your own canvas without a library (spec § "States without a document"): when
 * this browser holds a saved canvas, it can still be downloaded as stored, so
 * nothing a visitor typed is stranded. Renders nothing otherwise.
 */
export function StrandedDraft() {
  const stored = useStoredDraftText();
  if (stored === null) return null;
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm leading-relaxed">Your canvas is still saved in this browser. You can download it as it is.</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => downloadTextFile("business-model-canvas-draft.json", stored)}
      >
        <DownloadIcon aria-hidden="true" />
        Download your saved canvas
      </Button>
    </div>
  );
}
