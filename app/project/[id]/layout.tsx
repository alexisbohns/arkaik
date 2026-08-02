"use client";

import { useMemo } from "react";
import { usePathname, useParams, useSearchParams } from "next/navigation";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { NODE_PANEL_PARAM, NodePanelsProvider } from "@/lib/hooks/useNodePanels";
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
          : pathname.startsWith(`/project/${id}/acceptances`)
            ? "acceptances"
            : pathname.startsWith(`/project/${id}/pyramid`)
              ? "pyramid"
              : pathname.startsWith(`/project/${id}/settings`)
                ? "settings"
                : "maps";
  const currentSpecies = currentView === "library" ? searchParams.get("species") : null;
  // The species filter travels across projects; an open panel does not — its
  // node id means nothing in the project you are switching to.
  const currentQueryString = useMemo(() => {
    if (currentView !== "library") return "";
    const params = new URLSearchParams(searchParams.toString());
    params.delete(NODE_PANEL_PARAM);
    return params.toString();
  }, [currentView, searchParams]);

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

  // The panel stack lives here, not in a page: a page segment remounts whenever
  // its dynamic params change, which would reset the stack on every click.
  return (
    <NodePanelsProvider>
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
    </NodePanelsProvider>
  );
}
