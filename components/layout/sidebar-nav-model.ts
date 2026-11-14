import type { LucideIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import {
  BookOpenIcon,
  GalleryHorizontalEndIcon,
  GemIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MapIcon,
  MapPinnedIcon,
  NetworkIcon,
  PencilRulerIcon,
  PyramidIcon,
  RouteIcon,
  ScrollTextIcon,
  SquareKanbanIcon,
} from "lucide-react";
import type { ProjectView } from "@/components/layout/ProjectSwitcher";
import { SPECIES_NAV_ICONS, SPECIES_PLURALS } from "@/lib/config/species-icons";
import type { SpeciesId } from "@/lib/config/species";

/**
 * The project sidebar's navigation as DATA: every group, every row, which row
 * is active, which chord it answers to. The sidebar renders it; an alternative
 * rendering (a redesign, a tweak) reads the same model rather than re-deriving
 * "which row is active" — the rules below are the subtle part (Matrix is
 * active on any Quality page that is not Findings; "All maps" only when no
 * map is open; a species row only on its own `?species=` page).
 */
export interface SidebarNavItem {
  /** Stable id, also the `data-nav-item` hook. */
  id: string;
  href: string;
  label: string;
  /** The collapsed rail's tooltip. */
  tooltip: string;
  Icon: LucideIcon;
  active: boolean;
  /** The registry row whose chord this row answers to (⌥ hint), when it has one. */
  shortcutId?: string;
  /** A library species row carries its species, for species-tinted renderings. */
  species?: SpeciesId;
  /** A user-made map (`project.metadata.maps`), not one of the built-in four. */
  custom?: boolean;
}

export interface SidebarNavGroup {
  id: "project" | "quality" | "maps" | "library";
  label: string;
  items: SidebarNavItem[];
}

/** What a navigation rendering receives: the groups, plus the row behaviours it must keep. */
export interface SidebarNavModel {
  groups: SidebarNavGroup[];
  /**
   * The row's click handler — keeps an Option-held click an in-app jump (Next's
   * <Link> would otherwise let macOS download the link). On every row's Link.
   */
  onItemClick: (item: SidebarNavItem) => (event: MouseEvent) => void;
  /** The ⌥ chord hint for a row (null unless Option is held), placed at the row's end. */
  renderHint: (item: SidebarNavItem) => ReactNode;
}

export interface SidebarNavInput {
  projectId: string;
  currentView: ProjectView;
  currentSpecies: string | null;
  currentQualityView: "matrix" | "findings" | null;
  currentMapId: string | null;
  customMaps: readonly { id: string; title: string }[];
}

// One `?species=` library page per species — the sidebar is the only species
// selector. Acceptances and Decisions have pages of their own.
const LIBRARY_SPECIES = ["view", "flow", "data-model", "api-endpoint"] as const satisfies readonly SpeciesId[];

export function buildSidebarNav({
  projectId,
  currentView,
  currentSpecies,
  currentQualityView,
  currentMapId,
  customMaps,
}: SidebarNavInput): SidebarNavGroup[] {
  const base = `/project/${projectId}`;
  const maps = `${base}/maps`;
  const library = `${base}/library`;
  return [
    {
      id: "project",
      label: "Project",
      items: [
        { id: "overview", href: `${base}/overview`, label: "Overview", tooltip: "Overview", Icon: LayoutDashboardIcon, active: currentView === "overview", shortcutId: "nav-overview" },
        { id: "pyramid", href: `${base}/pyramid`, label: "Pyramid", tooltip: "Value pyramid", Icon: PyramidIcon, active: currentView === "pyramid", shortcutId: "nav-pyramid" },
        { id: "delivery", href: `${base}/delivery`, label: "Delivery", tooltip: "Delivery board", Icon: SquareKanbanIcon, active: currentView === "delivery", shortcutId: "nav-delivery" },
        { id: "design", href: `${base}/design`, label: "Design", tooltip: "Design funnel", Icon: PencilRulerIcon, active: currentView === "design" },
        { id: "changelog", href: `${base}/changelog`, label: "Changelog", tooltip: "Changelog", Icon: ScrollTextIcon, active: currentView === "changelog", shortcutId: "nav-changelog" },
      ],
    },
    {
      id: "quality",
      label: "Quality",
      items: [
        { id: "matrix", href: `${base}/quality/matrix`, label: "Matrix", tooltip: "Audit matrix", Icon: GemIcon, active: currentView === "quality" && currentQualityView !== "findings", shortcutId: "nav-matrix" },
        { id: "findings", href: `${base}/quality/findings`, label: "Findings", tooltip: "Findings", Icon: ListChecksIcon, active: currentView === "quality" && currentQualityView === "findings", shortcutId: "nav-findings" },
      ],
    },
    {
      id: "maps",
      label: "Maps",
      items: [
        { id: "maps", href: maps, label: "All maps", tooltip: "All maps", Icon: MapIcon, active: currentView === "maps" && currentMapId === null, shortcutId: "nav-maps" },
        { id: "journey", href: `${maps}/journey`, label: "Journey", tooltip: "Journey map", Icon: RouteIcon, active: currentView === "maps" && currentMapId === "journey", shortcutId: "nav-journey" },
        { id: "system", href: `${maps}/system`, label: "System", tooltip: "System map", Icon: NetworkIcon, active: currentView === "maps" && currentMapId === "system" },
        { id: "screens", href: `${maps}/screens`, label: "Screens", tooltip: "Screens map", Icon: GalleryHorizontalEndIcon, active: currentView === "maps" && currentMapId === "screens" },
        ...customMaps.map((map) => ({
          id: `map-${map.id}`,
          href: `${maps}/${map.id}`,
          label: map.title,
          tooltip: map.title,
          Icon: MapPinnedIcon,
          active: currentView === "maps" && currentMapId === map.id,
          custom: true,
        })),
      ],
    },
    {
      id: "library",
      label: "Library",
      items: [
        { id: "library", href: library, label: "All nodes", tooltip: "All nodes", Icon: BookOpenIcon, active: currentView === "library" && currentSpecies === null, shortcutId: "nav-library" },
        { id: "acceptances", href: `${base}/acceptances`, label: "Acceptances", tooltip: "Acceptances", Icon: SPECIES_NAV_ICONS.acceptance, active: currentView === "acceptances", shortcutId: "nav-acceptances", species: "acceptance" },
        { id: "decisions", href: `${base}/decisions`, label: "Decisions", tooltip: "Decisions", Icon: SPECIES_NAV_ICONS.decision, active: currentView === "decisions", species: "decision" },
        ...LIBRARY_SPECIES.map((species) => ({
          id: species,
          href: `${library}?species=${species}`,
          label: SPECIES_PLURALS[species],
          tooltip: SPECIES_PLURALS[species],
          Icon: SPECIES_NAV_ICONS[species],
          active: currentView === "library" && currentSpecies === species,
          species,
        })),
      ],
    },
  ];
}
