"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useParams, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { PublishDialog } from "@/components/publik/PublishDialog";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useProject } from "@/lib/hooks/useProject";
import { buildProjectCommands, type CommandActionId } from "@/lib/utils/command-palette";
import { isCommandPaletteShortcut } from "@/lib/utils/keyboard";

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";
  const { project } = useProject(id);
  const { theme, setTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Owned here rather than in the sidebar: the palette reaches Publish too, and
  // one dialog with two triggers beats two dialogs.
  const [publishOpen, setPublishOpen] = useState(false);

  const currentView = pathname.startsWith(`/project/${id}/overview`)
    ? "overview"
    : pathname.startsWith(`/project/${id}/library`)
      ? "library"
      : pathname.startsWith(`/project/${id}/delivery`)
        ? "delivery"
        : pathname.startsWith(`/project/${id}/changelog`)
          ? "changelog"
          : pathname.startsWith(`/project/${id}/acceptances`)
            ? "acceptances"
            : pathname.startsWith(`/project/${id}/pyramid`)
              ? "pyramid"
              : pathname.startsWith(`/project/${id}/settings`)
                ? "settings"
                : "maps";
  const currentSpecies = currentView === "library" ? searchParams.get("species") : null;
  const currentQueryString = currentView === "library" ? searchParams.toString() : "";

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

  const handleCommandAction = useCallback(
    (action: CommandActionId) => {
      if (action === "publish") {
        setPublishOpen(true);
        return;
      }
      setTheme(theme === "dark" ? "light" : "dark");
    },
    [setTheme, theme],
  );

  return (
    <SidebarProvider defaultOpen>
      <ProjectSidebar
        projectId={id}
        currentProjectTitle={project?.project.title}
        currentView={currentView}
        currentSpecies={currentSpecies}
        currentMapId={currentMapId}
        customMaps={customMaps}
        currentQueryString={currentQueryString}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        onOpenPublish={() => setPublishOpen(true)}
      />
      <SidebarInset className="h-svh overflow-hidden">
        {children}
      </SidebarInset>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={commands}
        onAction={handleCommandAction}
      />
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        projectId={id}
        projectTitle={project?.project.title ?? "Untitled project"}
      />
    </SidebarProvider>
  );
}
