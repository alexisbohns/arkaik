"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BookOpenIcon,
  DatabaseIcon,
  GitBranchIcon,
  HistoryIcon,
  MonitorIcon,
  RouteIcon,
  ServerIcon,
  SquareKanbanIcon,
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
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";

interface ProjectSidebarProps {
  projectId: string;
  currentProjectTitle?: string;
  currentView: "canvas" | "library" | "delivery" | "changelog";
  currentSpecies: string | null;
  currentQueryString?: string;
}

// One library page per species, driven from here — the sidebar is the only
// species selector (vision.md § Core Product, Information Architecture).
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
  const deliveryHref = `/project/${projectId}/delivery`;
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
          <SidebarGroupLabel>Maps</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={currentView === "canvas"} tooltip="Journey map">
                <Link href={canvasHref}>
                  <RouteIcon />
                  <span>Journey</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Library</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={currentView === "library" && currentSpecies === null}
                tooltip="All nodes"
              >
                <Link href={libraryHref}>
                  <BookOpenIcon />
                  <span>All nodes</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {LIBRARY_ITEMS.map((item) => (
              <SidebarMenuItem key={item.species}>
                <SidebarMenuButton
                  asChild
                  isActive={currentView === "library" && currentSpecies === item.species}
                  tooltip={item.label}
                >
                  <Link href={`${libraryHref}?species=${item.species}`}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Project</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={currentView === "delivery"} tooltip="Delivery board">
                <Link href={deliveryHref}>
                  <SquareKanbanIcon />
                  <span>Delivery</span>
                </Link>
              </SidebarMenuButton>
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
