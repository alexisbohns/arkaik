"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { serializeBundle } from "@arkaik/schema";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ProjectBundle } from "@/lib/data/types";
import { exportProject, importProject, normalizeProjectTimestamps, parseAndValidateBundle } from "@/lib/utils/export";

interface RawBundleSheetProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The raw project-bundle viewer/editor sheet — JSON/YAML view, guarded edit
 * mode, and save-back through the validated import path. Owns its whole state
 * machine. Mount with a fresh `key` per open (the JourneyMap does) so each
 * opening starts from initial state and the load effect stays purely async.
 */
export function RawBundleSheet({ projectId, open, onOpenChange }: RawBundleSheetProps) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [format, setFormat] = useState<"json" | "yaml">("json");
  const [bundle, setBundle] = useState<ProjectBundle | null>(null);
  const [draftJson, setDraftJson] = useState("");
  const [draftYaml, setDraftYaml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmEnterEditOpen, setConfirmEnterEditOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [pendingClose, setPendingClose] = useState(false);

  const baseText = useMemo(() => {
    if (!bundle) return "";
    return format === "json" ? serializeBundle(bundle) : stringifyYaml(bundle);
  }, [bundle, format]);

  const initialTexts = useMemo(() => {
    if (!bundle) {
      return { json: "", yaml: "" };
    }

    return {
      json: serializeBundle(bundle),
      yaml: stringifyYaml(bundle),
    };
  }, [bundle]);

  const draftText = format === "json" ? draftJson : draftYaml;
  const viewportText = mode === "edit" ? draftText : baseText;
  const hasUnsavedChanges = draftJson !== initialTexts.json || draftYaml !== initialTexts.yaml;

  const syncDrafts = useCallback((nextBundle: ProjectBundle) => {
    setDraftJson(serializeBundle(nextBundle));
    setDraftYaml(stringifyYaml(nextBundle));
  }, []);

  const parseDraftToBundle = useCallback((text: string, sourceFormat: "json" | "yaml"): ProjectBundle => {
    let parsed: unknown;

    try {
      parsed = sourceFormat === "json" ? JSON.parse(text) : parseYaml(text);
    } catch {
      throw new Error(sourceFormat === "json" ? "Invalid JSON syntax." : "Invalid YAML syntax.");
    }

    const parsedBundle = parseAndValidateBundle(parsed);

    return {
      ...parsedBundle,
      project: normalizeProjectTimestamps(parsedBundle.project),
    };
  }, []);

  const scopeBundleToCurrentProject = useCallback(
    (sourceBundle: ProjectBundle): ProjectBundle => ({
      ...sourceBundle,
      project: {
        ...sourceBundle.project,
        id: projectId,
      },
      nodes: sourceBundle.nodes.map((node) => ({
        ...node,
        project_id: projectId,
      })),
      edges: sourceBundle.edges.map((edge) => ({
        ...edge,
        project_id: projectId,
      })),
    }),
    [projectId],
  );

  // Load the export once per mount (the parent remounts this sheet per open),
  // keeping the effect free of synchronous setState.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    exportProject(projectId)
      .then((exported) => {
        if (cancelled) return;
        setBundle(exported);
        syncDrafts(exported);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        const message = loadError instanceof Error ? loadError.message : "Unknown raw export error";
        setError(`Unable to load raw export: ${message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId, syncDrafts]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }

      if (mode === "edit" && hasUnsavedChanges) {
        setPendingClose(true);
        setConfirmCancelOpen(true);
        return;
      }

      onOpenChange(false);
      setMode("view");
    },
    [hasUnsavedChanges, mode, onOpenChange],
  );

  const handleFormatChange = useCallback(
    (nextFormat: "json" | "yaml") => {
      if (nextFormat === format) return;

      if (mode !== "edit") {
        setFormat(nextFormat);
        return;
      }

      try {
        const parsed = parseDraftToBundle(draftText, format);
        setDraftJson(serializeBundle(parsed));
        setDraftYaml(stringifyYaml(parsed));
        setFormat(nextFormat);
        setError(null);
      } catch (formatError) {
        const message = formatError instanceof Error ? formatError.message : "Invalid raw draft.";
        toast.error(`Cannot switch format while editing: ${message}`);
      }
    },
    [draftText, format, mode, parseDraftToBundle],
  );

  const handleCopy = useCallback(async () => {
    if (!viewportText) return;

    setError(null);
    try {
      await navigator.clipboard.writeText(viewportText);
      setCopied(true);
    } catch {
      setError("Unable to copy raw export to clipboard.");
    }
  }, [viewportText]);

  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => {
      setCopied(false);
    }, 1200);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copied]);

  const handleConfirmEnterEdit = useCallback(() => {
    if (!bundle) return;
    syncDrafts(bundle);
    setMode("edit");
    setConfirmEnterEditOpen(false);
  }, [bundle, syncDrafts]);

  const handleRequestCancel = useCallback(() => {
    if (!hasUnsavedChanges) {
      setMode("view");
      return;
    }
    setConfirmCancelOpen(true);
  }, [hasUnsavedChanges]);

  const handleConfirmCancel = useCallback(() => {
    if (bundle) {
      syncDrafts(bundle);
    }

    setMode("view");
    setConfirmCancelOpen(false);

    if (pendingClose) {
      onOpenChange(false);
      setPendingClose(false);
    }
  }, [bundle, onOpenChange, pendingClose, syncDrafts]);

  const handleConfirmSave = useCallback(async () => {
    if (!projectId) {
      toast.error("Unable to save raw bundle: missing project id.");
      setConfirmSaveOpen(false);
      return;
    }

    try {
      const parsedBundle = parseDraftToBundle(draftText, format);
      const scopedBundle = scopeBundleToCurrentProject(parsedBundle);
      await importProject(scopedBundle);
      const refreshedBundle = await exportProject(projectId);
      setBundle(refreshedBundle);
      syncDrafts(refreshedBundle);
      setMode("view");
      setConfirmSaveOpen(false);
      setError(null);
      toast.success("Raw bundle saved successfully.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unknown save error";
      toast.error(`Raw bundle save failed: ${message}`);
      setMode("edit");
      setConfirmSaveOpen(false);
    }
  }, [draftText, format, parseDraftToBundle, projectId, scopeBundleToCurrentProject, syncDrafts]);

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent className="w-full sm:max-w-3xl">
          <SheetHeader className="pr-12">
            <SheetTitle>Raw project bundle</SheetTitle>
            <SheetDescription>Inspect the full export as JSON or YAML.</SheetDescription>
            {error && (
              <span className="text-xs text-destructive" role="status" aria-live="polite">
                {error}
              </span>
            )}
            <div className="flex items-center justify-between gap-2 pt-2">
              <div className="flex items-center gap-2">
                <Button size="sm" className="cursor-pointer" variant={format === "json" ? "default" : "outline"} onClick={() => handleFormatChange("json")}>
                  JSON
                </Button>
                <Button size="sm" className="cursor-pointer" variant={format === "yaml" ? "default" : "outline"} onClick={() => handleFormatChange("yaml")}>
                  YAML
                </Button>
              </div>
              {mode === "view" ? (
                <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => setConfirmEnterEditOpen(true)} disabled={!bundle || loading}>
                  Edit
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="cursor-pointer" onClick={handleRequestCancel}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="destructive" className="cursor-pointer" onClick={() => setConfirmSaveOpen(true)}>
                    Save
                  </Button>
                </div>
              )}
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 px-6 pb-6">
            <div className="group relative h-full">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleCopy()}
                disabled={!viewportText}
                className="absolute right-2 top-2 z-10 cursor-pointer opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <CopyIcon className="size-4" />
                {copied ? "Copied" : "Copy"}
              </Button>
              {mode === "edit" ? (
                <textarea
                  value={draftText}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (format === "json") {
                      setDraftJson(value);
                    } else {
                      setDraftYaml(value);
                    }
                  }}
                  spellCheck={false}
                  className="h-full w-full resize-none overflow-auto rounded-md border bg-muted/30 p-3 pr-24 font-mono text-xs leading-relaxed outline-none"
                />
              ) : (
                <pre className="h-full overflow-auto rounded-md border bg-muted/30 p-3 pr-24 text-xs leading-relaxed">
                  <code>{loading ? "Loading raw export..." : baseText || "No export available yet."}</code>
                </pre>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <DeleteConfirmDialog
        open={confirmEnterEditOpen}
        onOpenChange={setConfirmEnterEditOpen}
        title="Enable raw edit mode?"
        description="You are about to edit the full project payload directly. Saving runs validation for syntax and basic schema issues, but it cannot protect against unintended destructive changes to valid data."
        confirmLabel="Edit"
        onConfirm={handleConfirmEnterEdit}
      />
      <DeleteConfirmDialog
        open={confirmCancelOpen}
        onOpenChange={(nextOpen) => {
          setConfirmCancelOpen(nextOpen);
          if (!nextOpen) setPendingClose(false);
        }}
        title="Discard unsaved raw changes?"
        description="You have unsaved edits. Discarding now will permanently lose those changes."
        confirmLabel="Discard"
        onConfirm={handleConfirmCancel}
      />
      <DeleteConfirmDialog
        open={confirmSaveOpen}
        onOpenChange={setConfirmSaveOpen}
        title="Apply raw changes to this project?"
        description="This will replace the current graph data for this project and cannot be undone. Validation checks syntax and bundle shape, but valid edits can still remove or overwrite data unintentionally."
        confirmLabel="Save"
        onConfirm={() => {
          void handleConfirmSave();
        }}
      />
    </>
  );
}
