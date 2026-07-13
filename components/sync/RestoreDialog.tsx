"use client";

import { useEffect, useState } from "react";
import { ArrowLeftIcon, HistoryIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { importProjectFromFile } from "@/lib/utils/export";

interface RestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Skip the account project list and go straight to this project's versions. */
  initialProjectId?: string;
  initialProjectTitle?: string;
}

/** Wire shape of `GET /api/synk/projects` entries (lib/services/synk.ts `ProjectListing`) — only the fields this dialog renders. */
interface ServerProjectListing {
  project_id: string;
  title: string;
  latest_created_at: string | null;
}

/** Wire shape of `GET /api/synk/projects/{id}/backups` entries (lib/services/synk.ts `BackupListing`). */
interface ServerBackupListing {
  id: string;
  created_at: string;
  size_bytes: number;
  entity_count: number;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Restore flow (docs/spec/services.md § Synk → Client sync engine: "Restore
 * is an explicit user action (pick a version → import as local project,
 * existing collision handling applies)"). Two steps: pick one of the
 * account's backed-up projects (skipped when `initialProjectId` is given, so
 * a project card's "Restore…" action can jump straight to its own versions),
 * then pick a retained version.
 *
 * Restoring fetches the raw bundle JSON (`GET /api/synk/backups/{id}`) and
 * funnels it through the exact same `importProjectFromFile` path the manual
 * JSON import and the Publik import button use (`lib/utils/export.ts`) — so
 * ID-collision rewriting applies automatically and restoring always creates
 * a (possibly re-numbered) NEW local project. It never overwrites a live
 * local project in place, satisfying the spec's one-way-up boundary: this is
 * the one explicit, user-initiated exception that reads server state back
 * down, and even then only ever as a fresh import.
 */
export function RestoreDialog({ open, onOpenChange, initialProjectId, initialProjectTitle }: RestoreDialogProps) {
  const router = useRouter();
  const [step, setStep] = useState<"projects" | "versions">("projects");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projects, setProjects] = useState<ServerProjectListing[]>([]);
  const [selected, setSelected] = useState<{ id: string; title: string } | null>(null);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [backups, setBackups] = useState<ServerBackupListing[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setRestoringId(null);

    if (initialProjectId) {
      setSelected({ id: initialProjectId, title: initialProjectTitle ?? initialProjectId });
      setStep("versions");
      void loadBackups(initialProjectId);
      return;
    }

    setStep("projects");
    setSelected(null);
    setBackups([]);
    void loadProjects();
    // Fresh state every time the dialog (re)opens — see PublishDialog for the
    // same "reset on open" pattern this mirrors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialProjectId]);

  async function loadProjects() {
    setLoadingProjects(true);
    setError(null);
    try {
      const res = await fetch("/api/synk/projects", { cache: "no-store" });
      if (!res.ok) {
        setError(`Unable to load backed-up projects (HTTP ${res.status}).`);
        return;
      }
      const body = (await res.json()) as { projects?: ServerProjectListing[] };
      setProjects(body.projects ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load backed-up projects.");
    } finally {
      setLoadingProjects(false);
    }
  }

  async function loadBackups(projectId: string) {
    setLoadingBackups(true);
    setError(null);
    try {
      const res = await fetch(`/api/synk/projects/${encodeURIComponent(projectId)}/backups`, { cache: "no-store" });
      if (!res.ok) {
        setError(`Unable to load versions (HTTP ${res.status}).`);
        return;
      }
      const body = (await res.json()) as { backups?: ServerBackupListing[] };
      setBackups(body.backups ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load versions.");
    } finally {
      setLoadingBackups(false);
    }
  }

  function openProject(project: ServerProjectListing) {
    setSelected({ id: project.project_id, title: project.title });
    setStep("versions");
    void loadBackups(project.project_id);
  }

  async function handleRestore(backupId: string) {
    setRestoringId(backupId);
    setError(null);
    try {
      const res = await fetch(`/api/synk/backups/${encodeURIComponent(backupId)}`, { cache: "no-store" });
      if (!res.ok) {
        toast.error(
          res.status === 404 ? "This backup is no longer available." : `Unable to load backup (HTTP ${res.status}).`,
        );
        return;
      }
      const text = await res.text();
      const file = new File([text], `${selected?.title ?? "restored"}.json`, { type: "application/json" });
      const project = await importProjectFromFile(file);
      toast.success(`Restored "${project.title}" as a new local project.`);
      onOpenChange(false);
      router.push(`/project/${project.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown restore error";
      toast.error(`Restore failed: ${message}`);
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {step === "projects" ? (
          <>
            <DialogHeader>
              <DialogTitle>Restore from Synk</DialogTitle>
              <DialogDescription>
                Pick one of your account&apos;s backed-up projects, then a retained version. Restoring always
                creates a new local project — it never overwrites a project you already have.
              </DialogDescription>
            </DialogHeader>

            {loadingProjects ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : projects.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No projects have been backed up to Synk yet.
              </p>
            ) : (
              <ul className="max-h-80 space-y-1 overflow-y-auto">
                {projects.map((project) => (
                  <li key={project.project_id}>
                    <button
                      type="button"
                      onClick={() => openProject(project)}
                      className="flex w-full cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <span className="truncate font-medium">{project.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {project.latest_created_at ? formatDateTime(project.latest_created_at) : "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {!initialProjectId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 cursor-pointer"
                    onClick={() => {
                      setStep("projects");
                      setSelected(null);
                    }}
                    aria-label="Back to project list"
                  >
                    <ArrowLeftIcon className="size-4" />
                  </Button>
                )}
                <span className="truncate">Versions of &quot;{selected?.title}&quot;</span>
              </DialogTitle>
              <DialogDescription>
                Pick a retained version to import as a new local project (7-day retention — the newest version is
                always kept).
              </DialogDescription>
            </DialogHeader>

            {loadingBackups ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : backups.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No retained versions.</p>
            ) : (
              <ul className="max-h-80 space-y-1 overflow-y-auto">
                {backups.map((backup) => (
                  <li
                    key={backup.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate">{formatDateTime(backup.created_at)}</p>
                      <p className="text-xs text-muted-foreground">
                        {backup.entity_count} entit{backup.entity_count === 1 ? "y" : "ies"} ·{" "}
                        {formatSize(backup.size_bytes)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 cursor-pointer"
                      disabled={restoringId !== null}
                      onClick={() => void handleRestore(backup.id)}
                    >
                      {restoringId === backup.id ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : (
                        <HistoryIcon className="size-3.5" />
                      )}
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
