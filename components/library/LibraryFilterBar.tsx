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
      <ToolbarGroup className="w-full flex-[1_1_16rem] gap-3 md:max-w-md">
        <ProductOverrideSelector projectId={projectId} project={project} />
        <SearchInput
          value={search}
          onChange={onSearchChange}
          placeholder="Search title or description"
          aria-label="Search nodes"
          className="min-w-0 flex-1"
        />
      </ToolbarGroup>

      {/* `gap-3`: this band keeps the airier 12px between its controls. */}
      <ToolbarGroup className="gap-3">
        {/* `data-tone="error"`: the bar's skin (app/m3/controls.css) draws it
            in the error role — the glyph at rest, the error container once on. */}
        <Button
          type="button"
          variant="outline"
          data-tone="error"
          aria-pressed={blockedOnly}
          onClick={() => onBlockedOnlyChange(!blockedOnly)}
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
