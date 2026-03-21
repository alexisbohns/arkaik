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
import { localProvider } from "@/lib/data/local-provider";
import type { Project, ProjectBundle } from "@/lib/data/types";
import { archiveProject, importProjectFromFile } from "@/lib/utils/export";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { CreateProjectForm } from "@/components/panels/CreateProjectForm";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import pebbles from "@/seed/pebbles.json";
import arkaikSelfMap from "@/seed/arkaik-self-map.json";

type ExampleSeed = "pebbles" | "arkaik";

const EXAMPLE_SEEDS: Record<ExampleSeed, { fileName: string; data: unknown }> = {
  pebbles: { fileName: "pebbles.json", data: pebbles },
  arkaik: { fileName: "arkaik-self-map.json", data: arkaikSelfMap },
};

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectBundle | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadProjects() {
    setLoading(true);
    try {
      const list = await localProvider.listProjects();
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
        created_at: now,
        updated_at: now,
        archived_at: null,
      },
      nodes: [],
      edges: [],
    };

    await localProvider.saveProject(bundle);
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
        <ThemeToggle />
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
            <Button onClick={() => setCreateOpen(true)}>Create project</Button>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

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
                  <CardTitle>{bundle.project.title}</CardTitle>
                  {bundle.project.description && (
                    <CardDescription>{bundle.project.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {bundle.nodes.length} node{bundle.nodes.length !== 1 ? "s" : ""} ·{" "}
                    {bundle.edges.length} edge{bundle.edges.length !== 1 ? "s" : ""}
                  </p>
                </CardContent>
                <CardFooter className="flex items-center gap-2">
                  <Button size="sm" onClick={() => router.push(`/project/${bundle.project.id}`)}>
                    Open
                  </Button>
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
    </div>
  );
}
