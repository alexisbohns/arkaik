"use client";

import { SearchIcon, Grid3X3Icon, Table2Icon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { type SpeciesId } from "@/lib/config/species";
import { cn } from "@/lib/utils";

// Species selection is owned by the sidebar (?species= deep links); this bar
// only carries search and the display-mode toggle.
export type LibrarySpeciesFilter = "all" | SpeciesId;
export type LibraryDisplayMode = "gallery" | "directory";

interface LibraryFilterBarProps {
  search: string;
  displayMode: LibraryDisplayMode;
  onSearchChange: (query: string) => void;
  onDisplayModeChange: (mode: LibraryDisplayMode) => void;
}

export function LibraryFilterBar({
  search,
  displayMode,
  onSearchChange,
  onDisplayModeChange,
}: LibraryFilterBarProps) {
  return (
    <div className="rounded-xl border bg-card/70 p-3 md:p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-md">
          <SearchIcon className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search title or description"
            className="pl-8"
            aria-label="Search nodes"
          />
        </div>

        <div className="inline-flex items-center rounded-md border bg-background p-1">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
              displayMode === "gallery"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            onClick={() => onDisplayModeChange("gallery")}
            aria-pressed={displayMode === "gallery"}
          >
            <Grid3X3Icon className="size-3.5" />
            Grid
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
              displayMode === "directory"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            onClick={() => onDisplayModeChange("directory")}
            aria-pressed={displayMode === "directory"}
          >
            <Table2Icon className="size-3.5" />
            Table
          </button>
        </div>
      </div>
    </div>
  );
}
