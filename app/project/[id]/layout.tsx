"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useParams, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { KeyboardShortcutsDialog } from "@/components/layout/KeyboardShortcutsDialog";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { PublishDialog } from "@/components/publik/PublishDialog";
import { SeedSandboxBanner } from "@/components/projects/SeedSandboxBanner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { isSeedProjectId } from "@/lib/data/seed-project-id";
import {
  NODE_PANEL_PARAM,
  ProjectPanelsProvider,
  useProjectPanels,
} from "@/lib/hooks/useProjectPanels";
import { useProject } from "@/lib/hooks/useProject";
import { useProjectExport } from "@/lib/hooks/useProjectExport";
import { buildProjectCommands, type CommandActionId } from "@/lib/utils/command-palette";
import {
  isCommandPaletteShortcut,
  isEditableElement,
  isExportShortcut,
  isShortcutsDialogShortcut,
} from "@/lib/utils/keyboard";

// The panel stack lives here, not in a page: a page segment remounts whenever
// its dynamic params change, which would reset the stack on every click.
export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProjectPanelsProvider>
      <ProjectChrome>{children}</ProjectChrome>
    </ProjectPanelsProvider>
  );
}

/**
 * Everything below the provider. Split out precisely so it can call
 * `useProjectPanels` — a hook read in the same component that renders its
 * provider sees no context at all, and the raw bundle item in the switcher
 * needs `openRaw` from up here.
 */
function ProjectChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";
  const { project } = useProject(id);
  const { openRaw } = useProjectPanels();
  const { exportBundle } = useProjectExport(id);
  const { theme, setTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Owned here rather than in the sidebar: the palette reaches Publish too, and
  // one dialog with two triggers beats two dialogs.
  const [publishOpen, setPublishOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const currentView = pathname.startsWith(`/project/${id}/overview`)
    ? "overview"
    : pathname.startsWith(`/project/${id}/library`)
      ? "library"
      : pathname.startsWith(`/project/${id}/delivery`)
        ? "delivery"
        : pathname.startsWith(`/project/${id}/changelog`)
          ? "changelog"
          : pathname.startsWith(`/project/${id}/history`)
            ? "history"
            : pathname.startsWith(`/project/${id}/acceptances`)
              ? "acceptances"
              : pathname.startsWith(`/project/${id}/decisions`)
                ? "decisions"
                : pathname.startsWith(`/project/${id}/pyramid`)
                  ? "pyramid"
                  : pathname.startsWith(`/project/${id}/settings`)
                    ? "settings"
                    : "maps";
  const currentSpecies = currentView === "library" ? searchParams.get("species") : null;
  // The species filter travels across projects; an open panel does not — its
  // node id means nothing in the project you are switching to.
  const currentQueryString = useMemo(() => {
    if (currentView !== "library") return "";
    const params = new URLSearchParams(searchParams.toString());
    params.delete(NODE_PANEL_PARAM);
    return params.toString();
  }, [currentView, searchParams]);

  const mapsPrefix = `/project/${id}/maps/`;
  const currentMapId =
    currentView === "maps" && pathname.startsWith(mapsPrefix)
      ? decodeURIComponent(pathname.slice(mapsPrefix.length).split("/")[0] ?? "") || null
      : null;

  const customMaps = useMemo(() => {
    const stored = project?.project.metadata?.maps;
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((definition) => typeof definition?.id === "string" && typeof definition?.title === "string")
      .map((definition) => ({ id: definition.id, title: definition.title }));
  }, [project]);

  const commands = useMemo(
    () => buildProjectCommands({ projectId: id, customMaps }),
    [id, customMaps],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isCommandPaletteShortcut(event)) return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ⌘? — the cheat sheet, registered next to ⌘K for the same reason: it is a
  // property of the app, not of the page you happen to be on.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isShortcutsDialogShortcut(event)) return;
      event.preventDefault();
      setShortcutsOpen((open) => !open);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Registered here rather than on the Journey map, now that the button that
  // starts an export is in the switcher: a shortcut that only fired on one of
  // seven pages would contradict the menu item sitting on all of them. Still
  // inert inside a field — ⌘E is a text-editing chord on macOS, and the raw
  // bundle editor is a textarea.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isExportShortcut(event)) return;
      if (isEditableElement(event.target)) return;
      event.preventDefault();
      void exportBundle();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [exportBundle]);

  const handleCommandAction = useCallback(
    (action: CommandActionId) => {
      if (action === "publish") {
        setPublishOpen(true);
        return;
      }
      if (action === "show-shortcuts") {
        setShortcutsOpen(true);
        return;
      }
      setTheme(theme === "dark" ? "light" : "dark");
    },
    [setTheme, theme],
  );

  return (
    <SidebarProvider defaultOpen>
      {/* The whole bundle, not just the title: the product selector in the
          sidebar header reads `project.metadata.products`, and two props off the
          same object could disagree. */}
      <ProjectSidebar
        projectId={id}
        project={project}
        currentView={currentView}
        currentSpecies={currentSpecies}
        currentMapId={currentMapId}
        customMaps={customMaps}
        currentQueryString={currentQueryString}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        onOpenPublish={() => setPublishOpen(true)}
        onOpenRaw={openRaw}
      />
      {/* `flex-col` here (SidebarInset's own base classes are row-direction,
          fine for a single child) is what lets the banner sit above the page
          rather than beside it. That costs the page its free stretch: a
          column flex item doesn't grow to fill leftover space by default, so
          `{children}` gets its own `flex-1 min-h-0` wrapper to keep claiming
          the rest of the viewport and to let its own internal overflow/scroll
          keep working under the banner. */}
      <SidebarInset className="flex h-svh flex-col overflow-hidden">
        {isSeedProjectId(id) && <SeedSandboxBanner projectId={id} />}
        <div className="min-h-0 flex-1">{children}</div>
      </SidebarInset>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={commands}
        onAction={handleCommandAction}
      />
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} inProject />
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        projectId={id}
        projectTitle={project?.project.title ?? "Untitled project"}
      />
    </SidebarProvider>
  );
}
