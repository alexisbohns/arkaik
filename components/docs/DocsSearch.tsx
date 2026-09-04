"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { CommandPalette } from "@/components/layout/CommandPalette";
import { useModKeyLabel } from "@/lib/hooks/useModKeyLabel";
import {
  buildDocsCommands,
  type CommandActionId,
  type DocsPage,
} from "@/lib/utils/command-palette";
import { KeyboardShortcutsDialog } from "@/components/layout/KeyboardShortcutsDialog";
import { isCommandPaletteShortcut, isShortcutsDialogShortcut } from "@/lib/utils/keyboard";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

interface DocsSearchProps {
  pages: readonly DocsPage[];
}

/**
 * ⌘K for the documentation — the app's palette, pointed at the docs tree.
 *
 * The trigger and the shortcut live together here rather than being split
 * across the layout and the sidebar: the docs shell has no other command state
 * to own, so a self-contained row is the whole feature.
 *
 * That row is a `SidebarMenuButton` shaped exactly like `ProjectSidebar`'s
 * Search row, because it sits in the same slot of the same chrome. Search used
 * to live in a docs-only header bar; the header is gone, and searching the docs
 * should not look like a different gesture from searching a project.
 */
export function DocsSearch({ pages }: DocsSearchProps) {
  const modKey = useModKeyLabel();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const commands = useMemo(() => buildDocsCommands({ pages }), [pages]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isCommandPaletteShortcut(event)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isShortcutsDialogShortcut(event)) return;
      event.preventDefault();
      setShortcutsOpen((current) => !current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Publish is a project action and has no meaning here, so the docs catalogue
  // never offers it — the theme is the only action to dispatch.
  const handleAction = useCallback(
    (action: CommandActionId) => {
      if (action === "show-shortcuts") {
        setShortcutsOpen(true);
        return;
      }
      if (action !== "toggle-theme") return;
      setTheme(theme === "dark" ? "light" : "dark");
    },
    [setTheme, theme],
  );

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Search the documentation"
            onClick={() => setOpen(true)}
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

      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        commands={commands}
        onAction={handleAction}
        placeholder="Jump to a page of the documentation…"
        description="Search every page of the documentation, then press Enter to go there."
      />
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
