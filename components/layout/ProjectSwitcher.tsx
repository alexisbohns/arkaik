"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronsUpDownIcon, FolderOpenIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  useSidebar,
} from "@/components/ui/sidebar";
import { useProjects } from "@/lib/hooks/useProjects";

interface ProjectSwitcherProps {
  currentProjectId: string;
  currentProjectTitle?: string;
  currentView: "canvas" | "library";
  currentQueryString?: string;
}

export function ProjectSwitcher({
  currentProjectId,
  currentProjectTitle,
  currentView,
  currentQueryString,
}: ProjectSwitcherProps) {
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const { projects, loading } = useProjects();

  const sortedProjects = useMemo(
    () => [...projects].sort((left, right) => left.project.title.localeCompare(right.project.title)),
    [projects],
  );

  function buildProjectHref(projectId: string) {
    const basePath = `/project/${projectId}/${currentView}`;
    if (currentView !== "library" || !currentQueryString) {
      return basePath;
    }

    return `${basePath}?${currentQueryString}`;
  }

  function handleProjectSelect(projectId: string) {
    router.push(buildProjectHref(projectId));
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <FolderOpenIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {currentProjectTitle ?? "Loading project..."}
                </span>
                <span className="truncate text-xs text-sidebar-foreground/70">Switch project</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-64 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={6}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Projects</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {loading ? (
              <div className="space-y-1 p-1">
                <SidebarMenuSkeleton showIcon />
                <SidebarMenuSkeleton showIcon />
                <SidebarMenuSkeleton showIcon />
              </div>
            ) : (
              sortedProjects.map((projectBundle) => {
                const isCurrent = projectBundle.project.id === currentProjectId;

                return (
                  <DropdownMenuItem
                    key={projectBundle.project.id}
                    onClick={() => handleProjectSelect(projectBundle.project.id)}
                    className="gap-2 p-2"
                  >
                    <div className="flex size-6 items-center justify-center rounded-sm border bg-background">
                      <FolderOpenIcon className="size-3.5" />
                    </div>
                    <div className="grid flex-1 text-left leading-tight">
                      <span className="truncate">{projectBundle.project.title}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {projectBundle.nodes.length} node{projectBundle.nodes.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {isCurrent ? <CheckIcon className="size-4 text-muted-foreground" /> : null}
                  </DropdownMenuItem>
                );
              })
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}