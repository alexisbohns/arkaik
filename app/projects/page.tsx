"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArkaikLogo } from "@/components/branding/ArkaikLogo";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthButton } from "@/components/auth/AuthButton";
import { getProvider } from "@/lib/data/provider-registry";
import type { Project, ProjectBundle } from "@/lib/data/types";
import type { ProjectSummary } from "@/lib/data/data-provider";
import { Badge } from "@/components/ui/badge";
import { RepoLinksDialog } from "@/components/settings/RepoLinksDialog";
import { exportProject as exportProjectBundle } from "@/lib/utils/export";
import { createRemoteProvider } from "@/lib/data/remote-provider";
import { archiveProject, importProjectFromFile } from "@/lib/utils/export";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { CreateProjectForm } from "@/components/panels/CreateProjectForm";
import { PublishDialog } from "@/components/publik/PublishDialog";
import { ProjectSyncControl } from "@/components/sync/ProjectSyncControl";
import { RestoreDialog } from "@/components/sync/RestoreDialog";
import { SynkOnboardingBanner } from "@/components/sync/SynkOnboardingBanner";
import { CloudIcon, CloudUploadIcon, GithubIcon, HistoryIcon, Share2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthStatus } from "@/lib/hooks/useAuthStatus";
import pebbles from "@/seed/pebbles.json";
import arkaikSelfMap from "@/seed/arkaik-self-map.json";

type ExampleSeed = "pebbles" | "arkaik";

const EXAMPLE_SEEDS: Record<ExampleSeed, { fileName: string; data: unknown }> = {
  pebbles: { fileName: "pebbles.json", data: pebbles },
  arkaik: { fileName: "arkaik-self-map.json", data: arkaikSelfMap },
};

export default function ProjectsPage() {
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
  const authStatus = useAuthStatus();
  /** Hosting a project needs somewhere to put it — i.e. a signed-in account. */
  const canHost = authStatus.state === "signed-in";

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

  async function createProject(project: Pick<Project, "title" | "description">) {
    setError(null);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const bundle: ProjectBundle = {
      project: {
        id,
        title: project.title,
        description: project.description,
        metadata: {
          view_card_variant: "compact",
        },
        created_at: now,
        updated_at: now,
        archived_at: null,
      },
      nodes: [],
      edges: [],
    };

    await getProvider().saveProject(bundle);
    await loadProjects();
    router.push(`/project/${id}`);
  }

  async function handleImportExample(seed: ExampleSeed) {
    const selected = EXAMPLE_SEEDS[seed];
    setImporting(true);
    setError(null);
    try {
      const project = await importProjectFromFile(
        new File([JSON.stringify(selected.data)], selected.fileName, { type: "application/json" })
      );
      await loadProjects();
      router.push(`/project/${project.id}`);
    } catch (err) {
      console.error("[ProjectsPage] Failed to import example project:", err);
      setError("Failed to import example project");
    } finally {
      setImporting(false);
    }
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

    setImporting(true);
    setError(null);
    try {
      const project = await importProjectFromFile(file);
      await loadProjects();
      router.push(`/project/${project.id}`);
    } catch (err) {
      console.error("[ProjectsPage] Failed to import project JSON:", err);
      const message = err instanceof Error ? err.message : "Failed to import project JSON";
      setError(message);
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

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Projects</h1>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFileChange}
              className="hidden"
            />
            <Button
              variant="outline"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
            >
              {importing ? "Importing..." : "Import JSON"}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/generate">Generate with AI</Link>
            </Button>
            {auth.state === "signed-in" && (
              <Button variant="outline" onClick={() => setRestoreOpen(true)}>
                <HistoryIcon />
                Restore from Synk
              </Button>
            )}
            <Button onClick={() => setCreateOpen(true)}>Create project</Button>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && projects.length > 0 && <SynkOnboardingBanner projects={projects} />}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
            <p className="max-w-xs text-sm text-muted-foreground">
              No projects yet. Create one, import your JSON, or load the example project.
            </p>
            <div className="flex items-center gap-2">
              <Button onClick={() => setCreateOpen(true)}>Create project</Button>
              <Select
                disabled={importing}
                onValueChange={(value) => {
                  void handleImportExample(value as ExampleSeed);
                }}
              >
                <SelectTrigger className="w-[220px]" aria-label="Import example project">
                  <SelectValue placeholder={importing ? "Importing..." : "Import example project"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pebbles">Pebbles</SelectItem>
                  <SelectItem value="arkaik">Arkaik</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {projects.map((bundle) => (
              <Card key={bundle.project.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span className="truncate">{bundle.project.title}</span>
                    {bundle.hosted ? (
                      <Badge variant="outline" className="shrink-0 gap-1 font-normal">
                        <CloudIcon className="size-3" />
                        In your account
                      </Badge>
                    ) : null}
                  </CardTitle>
                  {bundle.project.description && (
                    <CardDescription>{bundle.project.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">
                    {bundle.nodeCount} node{bundle.nodeCount !== 1 ? "s" : ""} ·{" "}
                    {bundle.edgeCount} edge{bundle.edgeCount !== 1 ? "s" : ""}
                  </p>
                  {/* Synk backs up browser-held projects; a hosted project is
                      already on the server and has nothing to back up. */}
                  {bundle.hosted ? null : <ProjectSyncControl projectId={bundle.project.id} />}
                </CardContent>
                <CardFooter className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => router.push(`/project/${bundle.project.id}`)}>
                    Open
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPublishTarget(bundle)}>
                    <Share2Icon />
                    Publish
                  </Button>
                  {bundle.hosted ? (
                    <Button size="sm" variant="outline" onClick={() => setRepoTarget(bundle)}>
                      <GithubIcon />
                      Repos
                    </Button>
                  ) : null}
                  {!bundle.hosted && canHost ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={moving === bundle.project.id}
                      onClick={() => void moveToAccount(bundle)}
                    >
                      <CloudUploadIcon />
                      {moving === bundle.project.id ? "Moving…" : "Move to account"}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => setDeleteTarget(bundle)}>
                    Delete
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
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
