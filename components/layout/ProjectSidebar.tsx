"use client";

import { useRouter } from "next/navigation";
import { buildSidebarNav, type SidebarNavModel } from "@/components/layout/sidebar-nav-model";
import { ProductScopeSelector } from "@/components/layout/ProductScopeSelector";
import { SidebarIdentity, SidebarScope, SidebarSearch } from "@/components/layout/sidebar/SidebarHeaderParts";
import { SidebarNavTiles, SidebarNavTree } from "@/components/layout/sidebar/SidebarNav";
import { ProjectSwitcher, type ProjectView } from "@/components/layout/ProjectSwitcher";
import { Sidebar, SidebarContent, SidebarHeader, SidebarRail } from "@/components/ui/sidebar";
import { isSeedProjectId } from "@/lib/data/seed-project-id";
import { dynaPuff } from "@/lib/font-display";
import type { ProjectBundle } from "@/lib/data/types";
import { useModKeyLabel } from "@/lib/hooks/useModKeyLabel";
import { useOptionHeld } from "@/lib/hooks/useOptionHeld";
import { GUARDED_HOTKEY, useShortcuts } from "@/lib/hooks/useShortcut";
import { NAV_HOTKEY_ROUTES, formatChord, getShortcut } from "@/lib/utils/keyboard-shortcuts";

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
  /**
   * The project read failed, so `project` is `undefined` for good rather than
   * for now. The chrome stays mounted on a failed load — the switcher is the
   * way out — but it must not keep claiming to be loading (#362).
   */
  projectFailed?: boolean;
  currentView: ProjectView;
  currentSpecies: string | null;
  /** Which Quality page is open, when `currentView` is "quality". */
  currentQualityView: "matrix" | "findings" | null;
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

// An open modal owns the keyboard: ⌥D inside Delivery's new-node dialog must
// not navigate away and drop the draft. Matched by `data-slot`, not by
// `role="dialog"`: Radix popovers carry that role too, and a hovered chip's
// popover in the Library table must not silently disable navigation. Every
// Dialog (the ⌘K palette and the ⌘? sheet included) renders `dialog-content`.
// The mobile sidebar is a sheet — `data-mobile="true"` sits on that same
// `sheet-content` element — and it hosts these very links, so it does not
// count. No alert-dialog primitive exists yet; the role covers one if added.
const OPEN_MODAL_SELECTOR = [
  "[data-slot='dialog-content'][data-state='open']",
  "[data-slot='sheet-content'][data-state='open']:not([data-mobile='true'])",
  "[role='alertdialog'][data-state='open']",
].join(", ");

// The Search chip's skin, shared so the ⌘K chip and the ⌥ chips are one family.
const SIDEBAR_KBD_CLASS =
  "ml-auto inline-flex items-center rounded border bg-sidebar-accent px-1.5 py-0.5 font-sans text-[10px] font-medium group-data-[collapsible=icon]:hidden";

/**
 * A registry row's chord, drawn only while Option is held. It renders nothing
 * otherwise, so the sidebar does not reflow until someone asks. Hidden in icon
 * mode like the Search chip: a collapsed rail has no room for it.
 */
function ShortcutHint({ id, visible, modKey }: { id: string; visible: boolean; modKey: string | null }) {
  if (!visible || !modKey) return null;
  return <kbd className={SIDEBAR_KBD_CLASS}>{formatChord(getShortcut(id).keys, modKey)}</kbd>;
}

export function ProjectSidebar({
  projectId,
  project,
  projectFailed = false,
  currentView,
  currentSpecies,
  currentQualityView,
  currentMapId,
  customMaps,
  currentQueryString,
  onOpenCommandPalette,
  onOpenPublish,
  onOpenRaw,
}: ProjectSidebarProps) {
  const modKey = useModKeyLabel();
  const router = useRouter();
  const optionHeld = useOptionHeld();
  // Registered here because the sidebar already owns every destination and is
  // mounted on every project page (in a sheet on mobile, but mounted).
  // Guarded, so a declined chord (a modal is open, or the key is auto-
  // repeating) leaves the keystroke untouched rather than swallowing it.
  useShortcuts(
    Object.entries(NAV_HOTKEY_ROUTES).map(([shortcutId, route]) => ({
      id: shortcutId,
      callback: (event: KeyboardEvent) => {
        if (event.repeat || document.querySelector(OPEN_MODAL_SELECTOR)) return;
        event.preventDefault();
        router.push(`/project/${projectId}/${route}`);
      },
      options: GUARDED_HOTKEY,
    })),
  );
  // Next's <Link> treats an Option-held click as a "modified click" and lets
  // the browser handle it — which on macOS downloads the link, exactly what
  // holding Option to reveal a chord invites someone to do. Preventing
  // default (only for a bare Option click — Cmd/Ctrl/Shift-click still open
  // in a new tab as usual) and navigating ourselves keeps it a normal
  // in-app jump.
  const followOptionClick = (href: string) => (event: React.MouseEvent) => {
    if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      router.push(href);
    }
  };

  const navModel: SidebarNavModel = {
    groups: buildSidebarNav({ projectId, currentView, currentSpecies, currentQualityView, currentMapId, customMaps }),
    onItemClick: (item) => followOptionClick(item.href),
    renderHint: (item) =>
      item.shortcutId ? <ShortcutHint id={item.shortcutId} visible={optionHeld} modKey={modKey} /> : null,
  };
  const chord = modKey ? formatChord(getShortcut("command-palette").keys, modKey) : null;

  return (
    <Sidebar collapsible="icon" data-project-sidebar="">
      <SidebarHeader data-sb-header="">
        <SidebarIdentity projectTitle={project?.project.title}>
          <ProjectSwitcher
            currentProjectId={projectId}
            currentProjectTitle={project?.project.title}
            currentProjectFailed={projectFailed}
            currentView={currentView}
            currentQueryString={currentQueryString}
            onOpenPublish={onOpenPublish}
            onOpenRaw={onOpenRaw}
          />
        </SidebarIdentity>
        <SidebarScope
          selector={<ProductScopeSelector projectId={projectId} project={project} />}
          sandbox={isSeedProjectId(projectId)}
        />
        <SidebarSearch onOpen={onOpenCommandPalette} chord={chord} />
      </SidebarHeader>

      {/* Both looks' navigations; app/m3/sidebar.css shows the one `data-panel-look` asks for (see SidebarNav). */}
      <SidebarContent data-sb-content="" className={dynaPuff.variable}>
        <SidebarNavTiles model={navModel} />
        <SidebarNavTree model={navModel} />
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
