"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BookOpenIcon,
  DatabaseIcon,
  GitBranchIcon,
  HistoryIcon,
  LayoutPanelTopIcon,
  MonitorIcon,
  ServerIcon,
  Settings2Icon,
  Share2Icon,
} from "lucide-react";
import { ProjectSwitcher } from "@/components/layout/ProjectSwitcher";
import { PublishDialog } from "@/components/publik/PublishDialog";
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
  currentView: "canvas" | "library" | "changelog";
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
  const changelogHref = `/project/${projectId}/changelog`;
  const [publishOpen, setPublishOpen] = useState(false);

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

            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={currentView === "changelog"} tooltip="Changelog">
                <Link href={changelogHref}>
                  <HistoryIcon />
                  <span>Changelog</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Publish to Publik"
              onClick={() => setPublishOpen(true)}
              className="cursor-pointer"
            >
              <Share2Icon />
              <span>Publish</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton disabled tooltip="Settings coming soon">
              <Settings2Icon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        projectId={projectId}
        projectTitle={currentProjectTitle ?? "Untitled project"}
      />
    </Sidebar>
  );
}