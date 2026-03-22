"use client";

import Link from "next/link";
import {
  BookOpenIcon,
  DatabaseIcon,
  GitBranchIcon,
  LayoutPanelTopIcon,
  MonitorIcon,
  ServerIcon,
  Settings2Icon,
} from "lucide-react";
import { ProjectSwitcher } from "@/components/layout/ProjectSwitcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";

interface ProjectSidebarProps {
  projectId: string;
  currentProjectTitle?: string;
  currentView: "canvas" | "library";
  currentSpecies: string | null;
  currentQueryString?: string;
}

const LIBRARY_ITEMS = [
  { label: "Views", species: "view", icon: MonitorIcon },
  { label: "Flows", species: "flow", icon: GitBranchIcon },
  { label: "Data Models", species: "data-model", icon: DatabaseIcon },
  { label: "API Endpoints", species: "api-endpoint", icon: ServerIcon },
] as const;

export function ProjectSidebar({
  projectId,
  currentProjectTitle,
  currentView,
  currentSpecies,
  currentQueryString,
}: ProjectSidebarProps) {
  const canvasHref = `/project/${projectId}/canvas`;
  const libraryHref = `/project/${projectId}/library`;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ProjectSwitcher
          currentProjectId={projectId}
          currentProjectTitle={currentProjectTitle}
          currentView={currentView}
          currentQueryString={currentQueryString}
        />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigate</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={currentView === "canvas"} tooltip="Canvas">
                <Link href={canvasHref}>
                  <LayoutPanelTopIcon />
                  <span>Canvas</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={currentView === "library"} tooltip="Library">
                <Link href={libraryHref}>
                  <BookOpenIcon />
                  <span>Library</span>
                </Link>
              </SidebarMenuButton>
              <SidebarMenuSub>
                {LIBRARY_ITEMS.map((item) => (
                  <SidebarMenuSubItem key={item.species}>
                    <SidebarMenuSubButton
                      asChild
                      isActive={currentView === "library" && currentSpecies === item.species}
                    >
                      <Link href={`${libraryHref}?species=${item.species}`}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton disabled tooltip="Settings coming soon">
              <Settings2Icon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}