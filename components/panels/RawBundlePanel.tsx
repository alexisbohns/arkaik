"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { serializeBundle } from "@arkaik/schema";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectBundle } from "@/lib/data/types";
import { usePanelSelfState } from "@/lib/hooks/useProjectPanels";
import { exportProject, importProject, normalizeProjectTimestamps, parseAndValidateBundle } from "@/lib/utils/export";

interface RawBundlePanelProps {
  projectId: string;
  /** This panel's stack instance, for registering its self-state. */
  instanceId: string;
}

/**
 * The raw project-bundle viewer/editor — JSON/YAML view, guarded edit mode, and
 * save-back through the validated import path. Owns its whole state machine.
 *
 * It is a column in the panel grid, so mounting *is* opening: there is no
 * `open` prop to gate the load on, and `PanelEntry.instanceId` already gives one
 * mount per slot, which is what the old `key`-per-open remount was faking.
 *
 * Closing is the stack's, not ours — every close arrives through the guard
 * below, which answers with the stack's own `resume`. A self-close prop would
 * be dead API here, and worse, using one to finish a deferred close would
 * re-enter the guard and read a dirty flag React has not committed yet.
 */
export function RawBundlePanel({ projectId, instanceId }: RawBundlePanelProps) {
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
  // Holds the stack's `resume`, not a boolean: a vetoed close is one the stack
  // has already computed and is waiting on, so the confirm has to finish *that*
  // close rather than start a new one.
  const [pendingClose, setPendingClose] = useState<(() => void) | null>(null);

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

  // Load the export once per mount — the stack mounts one panel per open —
  // keeping the effect free of synchronous setState.
  useEffect(() => {
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
  }, [projectId, syncDrafts]);

  // Not a predicate: false vetoes and defers, and we owe the stack a `resume`
  // once the user has answered the discard confirm — a veto that never resumes
  // makes every close silently do nothing.
  const requestClose = useCallback(
    (resume: () => void) => {
      if (mode === "edit" && hasUnsavedChanges) {
        // The extra arrow is required: React reads a bare function argument to
        // a setter as an updater and would call it, closing the panel instantly.
        setPendingClose(() => resume);
        setConfirmCancelOpen(true);
        return false;
      }

      return true;
    },
    [hasUnsavedChanges, mode],
  );

  usePanelSelfState(instanceId, { requestClose, accent: mode === "edit" ? "editing" : null });

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

    // Resume the close the veto deferred, rather than starting a fresh one:
    // `resume` bypasses the guard, and a re-guarded close would read the dirty
    // flag React has not committed yet and veto forever.
    if (pendingClose) {
      pendingClose();
      setPendingClose(null);
    }
  }, [bundle, pendingClose, syncDrafts]);

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
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-6 pt-0">
        {/*
          The toolbar stays in the body rather than moving to the panel header:
          that slot is one left-aligned row sharing space with a fixed close
          button, and lifting four controls into it would drag `format`, `mode`
          and every handler that reads them out of the component that owns them.
        */}
        <div className="flex shrink-0 items-center justify-between gap-2 pt-4">
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
        {error && (
          <span className="shrink-0 text-xs text-destructive" role="status" aria-live="polite">
            {error}
          </span>
        )}
        <div className="group relative min-h-0 flex-1">
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
            <Textarea
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
              aria-label="Raw project bundle"
              // `h-full` and `p-3 pr-24` override the primitive: this one fills
              // its panel column and keeps a gutter clear for the floating Copy
              // button. The muted fill is stated for both themes because the
              // primitive's own dark fill is `bg-input/30`, and this box has to
              // stay the same colour as the `<pre>` it swaps places with.
              className="h-full resize-none overflow-auto bg-muted/30 dark:bg-muted/30 p-3 pr-24 font-mono text-xs leading-relaxed"
            />
          ) : (
            <pre className="h-full overflow-auto rounded-md border bg-muted/30 p-3 pr-24 text-xs leading-relaxed">
              <code>{loading ? "Loading raw export..." : baseText || "No export available yet."}</code>
            </pre>
          )}
        </div>
      </div>
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
          // Backing out of the confirm abandons the deferred close: the stack
          // is waiting on a `resume` that now must never come.
          if (!nextOpen) setPendingClose(null);
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
