"use client";

import { BanIcon, SearchIcon, Grid3X3Icon, Table2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { type SpeciesId } from "@/lib/config/species";

// Species selection is owned by the sidebar (?species= deep links); this bar
// only carries search and the display-mode toggle.
export type LibrarySpeciesFilter = "all" | SpeciesId;
export type LibraryDisplayMode = "gallery" | "directory";

const DISPLAY_MODES: readonly SegmentedControlOption<LibraryDisplayMode>[] = [
  { id: "gallery", label: "Grid", icon: Grid3X3Icon },
  { id: "directory", label: "Table", icon: Table2Icon },
];

interface LibraryFilterBarProps {
  search: string;
  displayMode: LibraryDisplayMode;
  /** Only nodes with a non-empty `metadata.blocked_by` — see `isBlocked`. */
  blockedOnly: boolean;
  onSearchChange: (query: string) => void;
  onDisplayModeChange: (mode: LibraryDisplayMode) => void;
  onBlockedOnlyChange: (blockedOnly: boolean) => void;
}

export function LibraryFilterBar({
  search,
  displayMode,
  blockedOnly,
  onSearchChange,
  onDisplayModeChange,
  onBlockedOnlyChange,
}: LibraryFilterBarProps) {
  return (
    <div className="rounded-xl border bg-card p-3 md:p-4">
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

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={blockedOnly ? "default" : "outline"}
            aria-pressed={blockedOnly}
            onClick={() => onBlockedOnlyChange(!blockedOnly)}
            className={blockedOnly ? "bg-red-500 text-white hover:bg-red-500/90" : "text-red-600 hover:text-red-700"}
          >
            <BanIcon className="size-4" /> Blocked
          </Button>

          <SegmentedControl
            options={DISPLAY_MODES}
            value={displayMode}
            onChange={onDisplayModeChange}
            ariaLabel="Display mode"
          />
        </div>
      </div>
    </div>
  );
}
