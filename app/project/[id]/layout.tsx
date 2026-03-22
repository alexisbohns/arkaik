"use client";

import { usePathname, useParams, useSearchParams } from "next/navigation";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { SPECIES } from "@/lib/config/species";
import { useProject } from "@/lib/hooks/useProject";

const SPECIES_LABELS = Object.fromEntries(SPECIES.map((species) => [species.id, species.label])) as Record<string, string>;

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";
  const { project, loading } = useProject(id);

  const currentView = pathname.startsWith(`/project/${id}/library`) ? "library" : "canvas";
  const currentSpecies = currentView === "library" ? searchParams.get("species") : null;
  const currentQueryString = currentView === "library" ? searchParams.toString() : "";
  const sectionLabel = currentView === "library"
    ? currentSpecies && SPECIES_LABELS[currentSpecies]
      ? `${SPECIES_LABELS[currentSpecies]} Library`
      : "Library"
    : "Canvas";

  return (
    <SidebarProvider defaultOpen>
      <ProjectSidebar
        projectId={id}
        currentProjectTitle={project?.project.title}
        currentView={currentView}
        currentSpecies={currentSpecies}
        currentQueryString={currentQueryString}
      />
      <SidebarInset className="h-svh overflow-hidden">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
