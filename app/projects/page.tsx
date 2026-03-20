"use client";

import { useEffect, useState } from "react";
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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
} from "@/components/ui/breadcrumb";
import { ArkaikLogo } from "@/components/branding/ArkaikLogo";
import { ThemeToggle } from "@/components/theme-toggle";
import { localProvider } from "@/lib/data/local-provider";
import type { ProjectBundle } from "@/lib/data/types";
import pebbles from "@/seed/pebbles.json";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    localProvider
      .listProjects()
      .then((list) => setProjects(list))
      .catch((err) => console.error("[ProjectsPage] Failed to load projects:", err))
      .finally(() => setLoading(false));
  }, []);

  async function handleImportExample() {
    setImporting(true);
    try {
      await localProvider.importProject(pebbles as ProjectBundle);
      router.push(`/project/${pebbles.project.id}`);
    } catch (err) {
      console.error("[ProjectsPage] Failed to import example project:", err);
    } finally {
      setImporting(false);
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
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
            <p className="max-w-xs text-sm text-muted-foreground">
              No projects yet. Import the example project to get started.
            </p>
            <Button onClick={handleImportExample} disabled={importing}>
              {importing ? "Importing…" : "Import example project"}
            </Button>
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
                <CardFooter>
                  <Button size="sm" onClick={() => router.push(`/project/${bundle.project.id}`)}>
                    Open
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
