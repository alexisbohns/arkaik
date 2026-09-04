"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  FolderOpenIcon,
  LayoutGridIcon,
  LibraryBigIcon,
} from "lucide-react";
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

/** The product's name, which is also the name of the space the docs describe. */
const SPACE_NAME = "arkaik";

/**
 * The docs shell's counterpart to `ProjectSwitcher`: the same lg row at the top
 * of the sidebar — icon square, name, subtitle, chevron — so the docs read as
 * another space of the same app rather than a separate site you were dropped
 * into.
 *
 * What differs is what it switches between. Inside a project the row switches
 * *projects*; here there is no project to switch, so the row switches *spaces*:
 * the documentation you are in, and the projects you can leave for. The icon
 * square wears the docs glyph for the same reason the project one wears a
 * folder — the square says where you are, the subtitle says what pressing it
 * does.
 */
export function DocsSpaceSwitcher() {
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const { projects, loading } = useProjects();

  const sortedProjects = useMemo(
    () => [...projects].sort((left, right) => left.project.title.localeCompare(right.project.title)),
    [projects],
  );

  function handleProjectSelect(projectId: string) {
    router.push(`/project/${projectId}`);
    // On mobile the sidebar is a sheet over the content, so leaving it open
    // would hide the page it just navigated to.
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
              className="cursor-pointer data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <LibraryBigIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold">{SPACE_NAME}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">Switch space</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-64 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={6}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Spaces</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="cursor-pointer gap-2 p-2">
              <Link href="/docs">
                <div className="flex size-6 items-center justify-center rounded-sm border bg-background">
                  <LibraryBigIcon className="size-3.5" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate">Documentation</span>
                  <span className="truncate text-xs text-muted-foreground">{SPACE_NAME}</span>
                </div>
                <CheckIcon className="size-4 text-muted-foreground" />
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Projects</DropdownMenuLabel>
            {loading ? (
              <div className="space-y-1 p-1">
                <SidebarMenuSkeleton showIcon />
                <SidebarMenuSkeleton showIcon />
                <SidebarMenuSkeleton showIcon />
              </div>
            ) : sortedProjects.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No projects yet.</p>
            ) : (
              sortedProjects.map((projectBundle) => (
                <DropdownMenuItem
                  key={projectBundle.project.id}
                  onClick={() => handleProjectSelect(projectBundle.project.id)}
                  className="cursor-pointer gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-sm border bg-background">
                    <FolderOpenIcon className="size-3.5" />
                  </div>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate">{projectBundle.project.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {projectBundle.nodeCount} node{projectBundle.nodeCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="cursor-pointer gap-2">
              <Link href="/projects">
                <LayoutGridIcon className="size-4" />
                <span>All projects</span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
