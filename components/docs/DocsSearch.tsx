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
import { isCommandPaletteShortcut } from "@/lib/utils/keyboard";
import { cn } from "@/lib/utils";

interface DocsSearchProps {
  pages: readonly DocsPage[];
  className?: string;
}

/**
 * ⌘K for the documentation — the app's palette, pointed at the docs tree.
 *
 * The trigger and the shortcut live together here rather than being split
 * across the layout and the sidebar: the docs shell has no other command state
 * to own, so a self-contained button is the whole feature.
 */
export function DocsSearch({ pages, className }: DocsSearchProps) {
  const modKey = useModKeyLabel();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

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

  // Publish is a project action and has no meaning here, so the docs catalogue
  // never offers it — the theme is the only action to dispatch.
  const handleAction = useCallback(
    (action: CommandActionId) => {
      if (action !== "toggle-theme") return;
      setTheme(theme === "dark" ? "light" : "dark");
    },
    [setTheme, theme],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // The label is hidden below sm, where the button is the icon alone.
        aria-label="Search docs"
        className={cn(
          "flex h-7 cursor-pointer items-center gap-2 rounded-md border bg-muted/40 px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          className,
        )}
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <span className="hidden sm:inline">Search docs</span>
        {modKey ? (
          <kbd className="hidden items-center rounded border bg-background px-1.5 py-0.5 font-sans text-[10px] font-medium sm:inline-flex">
            {modKey === "⌘" ? "⌘K" : "Ctrl+K"}
          </kbd>
        ) : null}
      </button>

      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        commands={commands}
        onAction={handleAction}
        placeholder="Jump to a page of the documentation…"
        description="Search every page of the documentation, then press Enter to go there."
      />
    </>
  );
}
