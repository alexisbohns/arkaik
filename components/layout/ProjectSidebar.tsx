"use client";

import Link from "next/link";
import {
  BookOpenIcon,
  ClipboardCheckIcon,
  DatabaseIcon,
  FileTextIcon,
  GitBranchIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  MapIcon,
  MapPinnedIcon,
  MonitorIcon,
  NetworkIcon,
  PyramidIcon,
  RouteIcon,
  SearchIcon,
  ServerIcon,
  SquareKanbanIcon,
  Settings2Icon,
  Share2Icon,
} from "lucide-react";
import { ProjectSwitcher, type ProjectView } from "@/components/layout/ProjectSwitcher";
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
import { useModKeyLabel } from "@/lib/hooks/useModKeyLabel";

interface ProjectSidebarProps {
  projectId: string;
  currentProjectTitle?: string;
  currentView: ProjectView;
  currentSpecies: string | null;
  /** Active map id when currentView is "maps" and a specific map is open. */
  currentMapId: string | null;
  /** Custom maps stored at project.metadata.maps, for direct navigation. */
  customMaps: readonly { id: string; title: string }[];
  currentQueryString?: string;
  /** Opens the ⌘K palette — the same overlay the shortcut summons. */
  onOpenCommandPalette: () => void;
  onOpenPublish: () => void;
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
  currentMapId,
  customMaps,
  currentQueryString,
  onOpenCommandPalette,
  onOpenPublish,
}: ProjectSidebarProps) {
  const modKey = useModKeyLabel();
  const overviewHref = `/project/${projectId}/overview`;
  const mapsHref = `/project/${projectId}/maps`;
  const libraryHref = `/project/${projectId}/library`;
  const deliveryHref = `/project/${projectId}/delivery`;
  const changelogHref = `/project/${projectId}/changelog`;
  const pyramidHref = `/project/${projectId}/pyramid`;
  const settingsHref = `/project/${projectId}/settings`;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ProjectSwitcher
          currentProjectId={projectId}
          currentProjectTitle={currentProjectTitle}
          currentView={currentView}
          currentQueryString={currentQueryString}
        />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Search and jump"
              onClick={onOpenCommandPalette}
              className="cursor-pointer text-sidebar-foreground/70"
            >
              <SearchIcon />
              <span>Search</span>
              {modKey ? (
                <kbd className="ml-auto inline-flex items-center rounded border bg-sidebar-accent px-1.5 py-0.5 font-sans text-[10px] font-medium group-data-[collapsible=icon]:hidden">
                  {modKey === "⌘" ? "⌘K" : "Ctrl+K"}
                </kbd>
              ) : null}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Project first — Overview is the landing page of a project. */}
        <SidebarGroup>
          <SidebarGroupLabel>Project</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={currentView === "overview"} tooltip="Overview">
                <Link href={overviewHref}>
                  <LayoutDashboardIcon />
                  <span>Overview</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={currentView === "pyramid"} tooltip="Value pyramid">
                <Link href={pyramidHref}>
                  <PyramidIcon />
                  <span>Pyramid</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
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

        <SidebarGroup>
          <SidebarGroupLabel>Maps</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={currentView === "maps" && currentMapId === null}
                tooltip="All maps"
              >
                <Link href={mapsHref}>
                  <MapIcon />
                  <span>All maps</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={currentView === "maps" && currentMapId === "journey"}
                tooltip="Journey map"
              >
                <Link href={`${mapsHref}/journey`}>
                  <RouteIcon />
                  <span>Journey</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={currentView === "maps" && currentMapId === "system"}
                tooltip="System map"
              >
                <Link href={`${mapsHref}/system`}>
                  <NetworkIcon />
                  <span>System</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {customMaps.map((map) => (
              <SidebarMenuItem key={map.id}>
                <SidebarMenuButton
                  asChild
                  isActive={currentView === "maps" && currentMapId === map.id}
                  tooltip={map.title}
                >
                  <Link href={`${mapsHref}/${map.id}`}>
                    <MapPinnedIcon />
                    <span>{map.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
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
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={currentView === "acceptances"} tooltip="Acceptances">
                <Link href={`/project/${projectId}/acceptances`}>
                  <ClipboardCheckIcon />
                  <span>Acceptances</span>
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
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Publish to Publik"
              onClick={onOpenPublish}
              className="cursor-pointer"
            >
              <Share2Icon />
              <span>Publish</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={currentView === "settings"} tooltip="Settings">
              <Link href={settingsHref}>
                <Settings2Icon />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Documentation">
              <a href="/docs" target="_blank" rel="noreferrer">
                <FileTextIcon />
                <span>Documentation</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
