"use client";

import { SearchIcon, Grid3X3Icon, Table2Icon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { ProductOverrideSelector } from "@/components/layout/ProductOverrideSelector";
import { type SpeciesId } from "@/lib/config/species";
import type { ProjectBundle } from "@/lib/data/types";

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
  onSearchChange: (query: string) => void;
  onDisplayModeChange: (mode: LibraryDisplayMode) => void;
  projectId: string;
  /** The bundle products live on. `undefined` until `useProject` resolves. */
  project: ProjectBundle | undefined;
}

export function LibraryFilterBar({
  search,
  displayMode,
  onSearchChange,
  onDisplayModeChange,
  projectId,
  project,
}: LibraryFilterBarProps) {
  return (
    <div className="rounded-xl border bg-card p-3 md:p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        {/* `md:max-w-md`, not wider: the control renders `null` for a project
            with no products, and this row must then be exactly the width it was
            before the control existed. */}
        <div className="flex w-full flex-1 items-center gap-2 md:max-w-md">
          <ProductOverrideSelector projectId={projectId} project={project} />
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search title or description"
              className="pl-8"
              aria-label="Search nodes"
            />
          </div>
        </div>

        <SegmentedControl
          options={DISPLAY_MODES}
          value={displayMode}
          onChange={onDisplayModeChange}
          ariaLabel="Display mode"
        />
      </div>
    </div>
  );
}
