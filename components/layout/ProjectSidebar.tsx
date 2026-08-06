"use client";

import Link from "next/link";
import {
  BookOpenIcon,
  LayoutDashboardIcon,
  MapIcon,
  MapPinnedIcon,
  NetworkIcon,
  PyramidIcon,
  RouteIcon,
  ScrollTextIcon,
  SearchIcon,
  SquareKanbanIcon,
} from "lucide-react";
import { ProductScopeSelector } from "@/components/layout/ProductScopeSelector";
import { ProjectSwitcher, type ProjectView } from "@/components/layout/ProjectSwitcher";
import { SeedSandboxNotice } from "@/components/projects/SeedSandboxNotice";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { SPECIES_NAV_ICONS, SPECIES_PLURALS } from "@/lib/config/species-icons";
import type { SpeciesId } from "@/lib/config/species";
import { isSeedProjectId } from "@/lib/data/seed-project-id";
import type { ProjectBundle } from "@/lib/data/types";
import { useModKeyLabel } from "@/lib/hooks/useModKeyLabel";

interface ProjectSidebarProps {
  projectId: string;
  /**
   * The loaded bundle. The sidebar took only the title before; the product
   * selector needs `project.metadata.products` too, and the title is right
   * there on the same object — passing both would be two props that can
   * disagree. `undefined` until `useProject` resolves, which the switcher
   * renders as "Loading project..." and the selector renders as nothing.
   */
  project: ProjectBundle | undefined;
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
  /** Pushes the raw bundle onto the panel stack — project-scoped, like Publish. */
  onOpenRaw: () => void;
}

// One `?species=` library page per species, driven from here — the sidebar is
// the only species selector (vision.md § Core Product, Information
// Architecture). Just the ids: the glyph and the plural come from the shared
// navigation vocabulary, which the command palette and the Inventory card read
// too, so the three cannot say "Flows" with three different icons.
//
// Acceptances and Decisions are absent on purpose — they have pages of their
// own rather than a `?species=` filter — but they take their glyphs from the
// same map below.
const LIBRARY_SPECIES = ["view", "flow", "data-model", "api-endpoint"] as const satisfies readonly SpeciesId[];

export function ProjectSidebar({
  projectId,
  project,
  currentView,
  currentSpecies,
  currentMapId,
  customMaps,
  currentQueryString,
  onOpenCommandPalette,
  onOpenPublish,
  onOpenRaw,
}: ProjectSidebarProps) {
  const modKey = useModKeyLabel();
  const overviewHref = `/project/${projectId}/overview`;
  const mapsHref = `/project/${projectId}/maps`;
  const libraryHref = `/project/${projectId}/library`;
  const deliveryHref = `/project/${projectId}/delivery`;
  const changelogHref = `/project/${projectId}/changelog`;
  const pyramidHref = `/project/${projectId}/pyramid`;
  const AcceptanceIcon = SPECIES_NAV_ICONS.acceptance;
  const DecisionIcon = SPECIES_NAV_ICONS.decision;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ProjectSwitcher
          currentProjectId={projectId}
          currentProjectTitle={project?.project.title}
          currentView={currentView}
          currentQueryString={currentQueryString}
          onOpenPublish={onOpenPublish}
          onOpenRaw={onOpenRaw}
        />
        <ProductScopeSelector projectId={projectId} project={project} />
        {isSeedProjectId(projectId) && <SeedSandboxNotice />}
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
                  <ScrollTextIcon />
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
                  <AcceptanceIcon />
                  <span>Acceptances</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={currentView === "decisions"} tooltip="Decisions">
                <Link href={`/project/${projectId}/decisions`}>
                  <DecisionIcon />
                  <span>Decisions</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {LIBRARY_SPECIES.map((species) => {
              const Icon = SPECIES_NAV_ICONS[species];
              const label = SPECIES_PLURALS[species];

              return (
                <SidebarMenuItem key={species}>
                  <SidebarMenuButton
                    asChild
                    isActive={currentView === "library" && currentSpecies === species}
                    tooltip={label}
                  >
                    <Link href={`${libraryHref}?species=${species}`}>
                      <Icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
