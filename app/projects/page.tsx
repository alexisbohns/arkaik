"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ArkaikLogo } from "@/components/branding/ArkaikLogo";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthButton } from "@/components/auth/AuthButton";
import { getProvider } from "@/lib/data/provider-registry";
import type { Project, ProjectBundle } from "@/lib/data/types";
import type { ProjectSummary } from "@/lib/data/data-provider";
import { RepoLinksDialog } from "@/components/settings/RepoLinksDialog";
import { exportProject as exportProjectBundle } from "@/lib/utils/export";
import { createRemoteProvider } from "@/lib/data/remote-provider";
import { archiveProject, importProjectFromFile, parseBundleFromFile } from "@/lib/utils/export";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { CreateProjectForm } from "@/components/panels/CreateProjectForm";
import { PublishDialog } from "@/components/publik/PublishDialog";
import { RestoreDialog } from "@/components/sync/RestoreDialog";
import { SynkOnboardingBanner } from "@/components/sync/SynkOnboardingBanner";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { ProjectSection } from "@/components/projects/ProjectSection";
import { groupBySection } from "@/lib/data/project-sections";
import {
  createInTarget,
  parseCreateTarget,
  type CreateTarget,
} from "@/lib/data/create-target";
import { syncManager } from "@/lib/sync/sync-manager";
import { useAuthStatus } from "@/lib/hooks/useAuthStatus";

/**
 * `useSearchParams` opts the tree out of prerendering, so the page body sits
 * behind a Suspense boundary — without it `next build` fails on `/projects`.
 */
export default function ProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectsPageBody />
    </Suspense>
  );
}

function ProjectsPageBody() {
  const router = useRouter();
  const auth = useAuthStatus();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [publishTarget, setPublishTarget] = useState<ProjectSummary | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [repoTarget, setRepoTarget] = useState<ProjectSummary | null>(null);
  const searchParams = useSearchParams();
  /** Ids of projects with a Synk backup — the ONLY thing that separates Synked from Lokal. */
  const [backedUpIds, setBackedUpIds] = useState<Set<string>>(new Set());
  /** Which section the in-flight create/import is destined for. */
  const [createTarget, setCreateTarget] = useState<CreateTarget>("lokal");
  const importTargetRef = useRef<CreateTarget>("lokal");
  const signedIn = auth.state === "signed-in";
  /** Hosting a project needs somewhere to put it — i.e. a signed-in account. */
  const canHost = signedIn;

  /**
   * Copy a browser-held project into the account.
   *
   * A COPY, not a move: the local original is left exactly where it is. The
   * hosted project gets a new server-owned id, so the two are genuinely
   * separate afterwards — and if anything goes wrong the user has lost nothing.
   * Deleting the local one is left to them, deliberately.
   */
  async function moveToAccount(summary: ProjectSummary) {
    setMoving(summary.project.id);
    setError(null);
    try {
      const bundle = await exportProjectBundle(summary.project.id);
      const created = await createRemoteProvider().importProject(bundle);
      toast.success(`"${bundle.project.title}" is now in your account.`);
      await loadProjects();
      router.push(`/project/${created.id}`);
    } catch (err) {
      console.error("[ProjectsPage] Failed to move project to account:", err);
      setError(err instanceof Error ? err.message : "Could not move this project to your account.");
    } finally {
      setMoving(null);
    }
  }

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadProjects() {
    setLoading(true);
    try {
      const list = await getProvider().listProjects();
      setProjects(list);
    } catch (err) {
      console.error("[ProjectsPage] Failed to load projects:", err);
      setError("Failed to load projects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  /**
   * The set of project ids Synk holds a backup for.
   *
   * This used to live inside `SynkOnboardingBanner`. It moved up here because
   * the sections need the same answer: a local project with a backup is Synked,
   * without one it is Lokal. Two independent fetches could disagree, and the
   * banner would then offer to back up a project already sitting under "Synked".
   */
  const loadBackedUpIds = useCallback(async () => {
    if (!signedIn) {
      setBackedUpIds(new Set());
      return;
    }
    try {
      const res = await fetch("/api/synk/projects", { cache: "no-store" });
      if (!res.ok) {
        setBackedUpIds(new Set());
        return;
      }
      const body = (await res.json()) as { projects?: Array<{ project_id: string }> };
      setBackedUpIds(new Set((body.projects ?? []).map((p) => p.project_id)));
    } catch {
      setBackedUpIds(new Set());
    }
  }, [signedIn]);

  useEffect(() => {
    void loadBackedUpIds();
  }, [loadBackedUpIds]);

  // A project that just got backed up — via the banner, the per-card control, or
  // a Synked creation — must hop from Lokal to Synked without a page reload.
  useEffect(
    () =>
      syncManager.subscribe(() => {
        void loadBackedUpIds();
      }),
    [loadBackedUpIds]
  );

  // Coming back from /generate with a target in hand: open the file picker on
  // that section and drop the param, so a refresh does not re-open it.
  useEffect(() => {
    const target = parseCreateTarget(searchParams.get("import"));
    if (!target) return;
    window.history.replaceState(null, "", "/projects");
    importTargetRef.current = target;
    fileInputRef.current?.click();
  }, [searchParams]);

  /** The injected effects `createInTarget` routes between. */
  const targetDeps = {
    saveLocal: async (bundle: ProjectBundle) => {
      await getProvider().saveProject(bundle);
      return bundle.project.id;
    },
    importHosted: async (bundle: ProjectBundle) => {
      const created = await createRemoteProvider().importProject(bundle);
      return created.id;
    },
    backupNow: (projectId: string) => syncManager.backupNow(projectId),
  };

  async function createProject(project: Pick<Project, "title" | "description">) {
    setError(null);
    const now = new Date().toISOString();
    const bundle: ProjectBundle = {
      project: {
        id: crypto.randomUUID(),
        title: project.title,
        description: project.description,
        metadata: { view_card_variant: "compact" },
        created_at: now,
        updated_at: now,
        archived_at: null,
      },
      nodes: [],
      edges: [],
    };

    try {
      const { id, backupError } = await createInTarget(createTarget, bundle, targetDeps);
      if (backupError) toast.error(`Created, but the backup failed: ${backupError}`);
      await loadProjects();
      await loadBackedUpIds();
      router.push(`/project/${id}`);
    } catch (err) {
      console.error("[ProjectsPage] Failed to create project:", err);
      setError(err instanceof Error ? err.message : "Could not create this project.");
    }
  }

  function openImportPicker(target: CreateTarget) {
    importTargetRef.current = target;
    fileInputRef.current?.click();
  }

  async function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const MAX_IMPORT_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_IMPORT_SIZE) {
      setError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 5 MB.`);
      return;
    }

    const target = importTargetRef.current;
    setImporting(true);
    setError(null);
    try {
      let id: string;
      let backupError: string | null = null;

      if (target === "hosted") {
        // Straight to the account — never write it to this browser on the way.
        const bundle = await parseBundleFromFile(file);
        id = await targetDeps.importHosted(bundle);
      } else {
        // The local path does its own id-uniquing, which the hosted one must not.
        const project = await importProjectFromFile(file);
        id = project.id;
        if (target === "synked") {
          try {
            await syncManager.backupNow(id);
          } catch (err) {
            backupError = err instanceof Error ? err.message : "Backup failed";
          }
        }
      }

      if (backupError) toast.error(`Imported, but the backup failed: ${backupError}`);
      await loadProjects();
      await loadBackedUpIds();
      router.push(`/project/${id}`);
    } catch (err) {
      console.error("[ProjectsPage] Failed to import project JSON:", err);
      setError(err instanceof Error ? err.message : "Failed to import project JSON");
    } finally {
      setImporting(false);
    }
  }

  async function handleArchiveProject() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await archiveProject(deleteTarget.project.id);
      setDeleteTarget(null);
      await loadProjects();
    } catch (err) {
      console.error("[ProjectsPage] Failed to archive project:", err);
      setError("Failed to archive project");
    } finally {
      setDeleting(false);
    }
  }

  const grouped = groupBySection(projects, backedUpIds);

  const openCreateDialog = (target: CreateTarget) => {
    setCreateTarget(target);
    setCreateOpen(true);
  };

  // `ProjectSection` calls this via `items.map(renderCard)`, so it must set the key.
  const renderCard = (summary: ProjectSummary) => (
    <ProjectCard
      key={summary.project.id}
      summary={summary}
      canHost={canHost}
      moving={moving === summary.project.id}
      onOpen={() => router.push(`/project/${summary.project.id}`)}
      onPublish={() => setPublishTarget(summary)}
      onRepos={() => setRepoTarget(summary)}
      onMoveToAccount={() => void moveToAccount(summary)}
      onDelete={() => setDeleteTarget(summary)}
    />
  );

  return (
    <div className="flex flex-1 flex-col bg-background font-sans">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/" aria-label="Go to home" className="inline-flex items-center">
          <ArkaikLogo className="w-20 shrink-0" />
        </Link>
        <div className="flex items-center gap-2">
          <AuthButton />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Projects</h1>
          {/* One shared picker: `importTargetRef` carries which section asked. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFileChange}
            className="hidden"
          />
          {/* Signed out there is only one kind of project, so the sole control
              sits up here rather than under a heading that says nothing. */}
          {!signedIn && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="cursor-pointer"
                disabled={importing}
                onClick={() => openImportPicker("lokal")}
              >
                {importing ? "Importing..." : "Import JSON"}
              </Button>
              <Button variant="outline" className="cursor-pointer" asChild>
                <Link href="/generate?target=lokal">Generate with AI</Link>
              </Button>
              <Button className="cursor-pointer" onClick={() => openCreateDialog("lokal")}>
                Create project
              </Button>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Only relevant when something is actually un-backed-up and local. */}
        {!loading && grouped.lokal.length > 0 && (
          <SynkOnboardingBanner projects={grouped.lokal} backedUpIds={backedUpIds} />
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : !signedIn ? (
          /* Signed out: no sections. Hosted and Synked are impossible without an
             account, and the local-first promise is that signing in ADDS things
             rather than rearranging what was already there. */
          grouped.lokal.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
              <p className="max-w-xs text-sm text-muted-foreground">
                No projects yet. Create one or import your JSON.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {grouped.lokal.map(renderCard)}
            </div>
          )
        ) : (
          <>
            <ProjectSection
              target="hosted"
              items={grouped.hosted}
              renderCard={renderCard}
              disabled={importing}
              onCreate={() => openCreateDialog("hosted")}
              onImport={() => openImportPicker("hosted")}
            />

            <ProjectSection
              target="synked"
              items={grouped.synked}
              renderCard={renderCard}
              disabled={importing}
              onCreate={() => openCreateDialog("synked")}
              onImport={() => openImportPicker("synked")}
              onRestore={() => setRestoreOpen(true)}
            />

            <ProjectSection
              target="lokal"
              items={grouped.lokal}
              renderCard={renderCard}
              disabled={importing}
              onCreate={() => openCreateDialog("lokal")}
              onImport={() => openImportPicker("lokal")}
            />
          </>
        )}
      </main>

      <CreateProjectForm open={createOpen} onOpenChange={setCreateOpen} onSubmit={createProject} />

      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete project"
        description={`Archive \"${deleteTarget?.project.title ?? "this project"}\" and remove it from your list?`}
        onConfirm={handleArchiveProject}
      />

      <RepoLinksDialog
        projectId={repoTarget?.project.id ?? ""}
        projectTitle={repoTarget?.project.title ?? "this project"}
        open={Boolean(repoTarget)}
        onOpenChange={(next) => {
          if (!next) setRepoTarget(null);
        }}
      />
      <PublishDialog
        open={Boolean(publishTarget)}
        onOpenChange={(open) => {
          if (!open) setPublishTarget(null);
        }}
        projectId={publishTarget?.project.id ?? ""}
        projectTitle={publishTarget?.project.title ?? "this project"}
      />

      <RestoreDialog open={restoreOpen} onOpenChange={setRestoreOpen} />
    </div>
  );
}
