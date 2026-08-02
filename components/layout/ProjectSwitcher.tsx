"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  Code2Icon,
  DownloadIcon,
  FileTextIcon,
  FolderOpenIcon,
  GithubIcon,
  KeyRoundIcon,
  LogOutIcon,
  Settings2Icon,
  Share2Icon,
} from "lucide-react";
import { signIn, signOut } from "next-auth/react";
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
import { useAuthStatus } from "@/lib/hooks/useAuthStatus";
import { useProjectExport } from "@/lib/hooks/useProjectExport";
import { useProjects } from "@/lib/hooks/useProjects";

/**
 * The project-scoped pages, which are also the path segment each one lives at —
 * `buildProjectHref` below appends the value verbatim, so switching project
 * lands on the same page in the new one. Declared once and shared with
 * `ProjectSidebar`: two copies drifted apart the moment Settings was added.
 */
export type ProjectView =
  | "overview"
  | "maps"
  | "library"
  | "delivery"
  | "changelog"
  | "acceptances"
  | "pyramid"
  | "settings";

interface ProjectSwitcherProps {
  currentProjectId: string;
  currentProjectTitle?: string;
  currentView: ProjectView;
  currentQueryString?: string;
  onOpenPublish: () => void;
  onOpenRaw: () => void;
}

export function ProjectSwitcher({
  currentProjectId,
  currentProjectTitle,
  currentView,
  currentQueryString,
  onOpenPublish,
  onOpenRaw,
}: ProjectSwitcherProps) {
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const { projects, loading } = useProjects();
  const authStatus = useAuthStatus();
  const { exportBundle, exporting } = useProjectExport(currentProjectId);
  const settingsHref = `/project/${currentProjectId}/settings`;

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

  // Same reason as switching project: on mobile the sidebar is a sheet over the
  // content, so the raw panel would open behind it and look like nothing did.
  function handleOpenRaw() {
    onOpenRaw();
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
                <FolderOpenIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold">
                  {currentProjectTitle ?? "Loading project..."}
                </span>
                <span className="truncate text-xs text-sidebar-foreground/70">Switch project</span>
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
                    {isCurrent ? <CheckIcon className="size-4 text-muted-foreground" /> : null}
                  </DropdownMenuItem>
                );
              })
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer gap-2" onClick={onOpenPublish}>
              <Share2Icon className="size-4" />
              <span>Publish</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onClick={() => void exportBundle()}
              disabled={exporting}
            >
              <DownloadIcon className="size-4" />
              <span>{exporting ? "Exporting..." : "Export JSON"}</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer gap-2" onClick={handleOpenRaw}>
              <Code2Icon className="size-4" />
              <span>Raw bundle</span>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="cursor-pointer gap-2">
              <Link href={settingsHref}>
                <Settings2Icon className="size-4" />
                <span>Settings</span>
              </Link>
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="cursor-pointer gap-2">
              <a href="/docs" target="_blank" rel="noreferrer">
                <FileTextIcon className="size-4" />
                <span>Documentation</span>
              </a>
            </DropdownMenuItem>
            {authStatus.state === "signed-out" && (
              <DropdownMenuItem
                className="cursor-pointer gap-2"
                onClick={() => void signIn("github")}
              >
                <GithubIcon className="size-4" />
                <span>Sign in with GitHub</span>
              </DropdownMenuItem>
            )}
            {authStatus.state === "signed-in" && (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {authStatus.user.name ?? authStatus.user.email ?? "Account"}
                </DropdownMenuLabel>
                {/* Account-level, like sign-out — a token reaches every project
                    of the account, not the one currently open. */}
                <DropdownMenuItem asChild className="cursor-pointer gap-2">
                  <Link href="/settings/tokens">
                    <KeyRoundIcon className="size-4" />
                    <span>Agent tokens</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer gap-2"
                  onClick={() => void signOut()}
                >
                  <LogOutIcon className="size-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}