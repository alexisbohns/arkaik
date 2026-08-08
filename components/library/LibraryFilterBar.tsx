"use client";

import { BanIcon, Grid3X3Icon, Table2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { ProductOverrideSelector } from "@/components/layout/ProductOverrideSelector";
import { Toolbar, ToolbarGroup } from "@/components/layout/Toolbar";
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
  /** Only nodes with a non-empty `metadata.blocked_by` — see `isBlocked`. */
  blockedOnly: boolean;
  onSearchChange: (query: string) => void;
  onDisplayModeChange: (mode: LibraryDisplayMode) => void;
  onBlockedOnlyChange: (blockedOnly: boolean) => void;
  projectId: string;
  /** The bundle products live on. `undefined` until `useProject` resolves. */
  project: ProjectBundle | undefined;
}

export function LibraryFilterBar({
  search,
  displayMode,
  blockedOnly,
  onSearchChange,
  onDisplayModeChange,
  onBlockedOnlyChange,
  projectId,
  project,
}: LibraryFilterBarProps) {
  return (
    <Toolbar>
      {/* `md:max-w-md`, not wider: the control renders `null` for a project
          with no products, and this row must then be exactly the width it was
          before the control existed. */}
      <ToolbarGroup className="w-full flex-1 md:max-w-md">
        <ProductOverrideSelector projectId={projectId} project={project} />
        <SearchInput
          value={search}
          onChange={onSearchChange}
          placeholder="Search title or description"
          aria-label="Search nodes"
          className="min-w-0 flex-1"
        />
      </ToolbarGroup>

      <ToolbarGroup>
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
      </ToolbarGroup>
    </Toolbar>
  );
}
