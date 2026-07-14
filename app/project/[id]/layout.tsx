"use client";

import { useMemo } from "react";
import { usePathname, useParams, useSearchParams } from "next/navigation";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useProject } from "@/lib/hooks/useProject";

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";
  const { project } = useProject(id);

  const currentView = pathname.startsWith(`/project/${id}/overview`)
    ? "overview"
    : pathname.startsWith(`/project/${id}/library`)
      ? "library"
      : pathname.startsWith(`/project/${id}/delivery`)
        ? "delivery"
        : pathname.startsWith(`/project/${id}/changelog`)
          ? "changelog"
          : "maps";
  const currentSpecies = currentView === "library" ? searchParams.get("species") : null;
  const currentQueryString = currentView === "library" ? searchParams.toString() : "";

  const mapsPrefix = `/project/${id}/maps/`;
  const currentMapId =
    currentView === "maps" && pathname.startsWith(mapsPrefix)
      ? decodeURIComponent(pathname.slice(mapsPrefix.length).split("/")[0] ?? "") || null
      : null;

  const customMaps = useMemo(() => {
    const stored = project?.project.metadata?.maps;
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((definition) => typeof definition?.id === "string" && typeof definition?.title === "string")
      .map((definition) => ({ id: definition.id, title: definition.title }));
  }, [project]);

  return (
    <SidebarProvider defaultOpen>
      <ProjectSidebar
        projectId={id}
        currentProjectTitle={project?.project.title}
        currentView={currentView}
        currentSpecies={currentSpecies}
        currentMapId={currentMapId}
        customMaps={customMaps}
        currentQueryString={currentQueryString}
      />
      <SidebarInset className="h-svh overflow-hidden">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
