"use client";

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

  const currentView = pathname.startsWith(`/project/${id}/library`) ? "library" : "canvas";
  const currentSpecies = currentView === "library" ? searchParams.get("species") : null;
  const currentQueryString = currentView === "library" ? searchParams.toString() : "";

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
