"use client";

import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { ProductOverrideSelector } from "@/components/layout/ProductOverrideSelector";
import { Toolbar, ToolbarGroup } from "@/components/layout/Toolbar";
import type { PlatformId } from "@/lib/config/platforms";
import type { SpeciesId } from "@/lib/config/species";
import { SPECIES_PLURALS } from "@/lib/config/species-icons";
import type { ProjectBundle } from "@/lib/data/types";
import { usePlatformFilterControl } from "@/lib/hooks/usePlatformFilterControl";

export type DeliveryPlatformFilter = "all" | PlatformId;

interface DeliveryFilterBarProps {
  platform: DeliveryPlatformFilter;
  species: readonly SpeciesId[];
  showAllStatuses: boolean;
  search: string;
  onPlatformChange: (platform: DeliveryPlatformFilter) => void;
  onToggleSpecies: (species: SpeciesId) => void;
  onShowAllStatusesChange: (value: boolean) => void;
  onSearchChange: (query: string) => void;
  projectId: string;
  /** The bundle products live on. `undefined` until `useProject` resolves. */
  project: ProjectBundle | undefined;
}

// Flows are not deliverables (their status is a rollup of their views), so the
// board offers the item-bearing species, in the order they read on the board.
// Views are the default lens; acceptances are the atomic parity unit (spec
// §9.3). Labels come from the shared plural vocabulary — the sidebar, the
// palette and the Inventory card name these same four the same way.
const SPECIES_OPTIONS = ["view", "acceptance", "api-endpoint", "data-model"] as const satisfies readonly SpeciesId[];

export function DeliveryFilterBar({
  platform,
  species,
  showAllStatuses,
  search,
  onPlatformChange,
  onToggleSpecies,
  onShowAllStatusesChange,
  onSearchChange,
  projectId,
  project,
}: DeliveryFilterBarProps) {
  // Same arity rule and same stale-filter reset as the Acceptances bar; only
  // the rendering below (toggle buttons, not a Select) is this bar's own.
  const { showPlatformFilter, platformOptions } = usePlatformFilterControl(
    projectId,
    project,
    platform,
    () => onPlatformChange("all"),
  );

  return (
    <Toolbar>
      {/* The board's filters are toggle rows rather than menus, so they need
          more of the band than the other surfaces' do — search takes the right
          edge and the four narrowing groups share the left, wrapping among
          themselves rather than each claiming a line of its own. */}
      <ToolbarGroup className="gap-x-4 gap-y-2">
        <ProductOverrideSelector projectId={projectId} project={project} />
        {showPlatformFilter && (
          <ToolbarGroup>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Platform</span>
            <Button
              type="button"
              variant={platform === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => onPlatformChange("all")}
            >
              All
            </Button>
            {platformOptions.map((option) => (
              <Button
                key={option.id}
                type="button"
                variant={platform === option.id ? "default" : "outline"}
                size="sm"
                onClick={() => onPlatformChange(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </ToolbarGroup>
        )}

        <ToolbarGroup>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Species</span>
          {SPECIES_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              variant={species.includes(option) ? "default" : "outline"}
              size="sm"
              aria-pressed={species.includes(option)}
              onClick={() => onToggleSpecies(option)}
            >
              {SPECIES_PLURALS[option]}
            </Button>
          ))}
        </ToolbarGroup>

        <Button
          type="button"
          variant={showAllStatuses ? "default" : "outline"}
          size="sm"
          aria-pressed={showAllStatuses}
          onClick={() => onShowAllStatusesChange(!showAllStatuses)}
        >
          All statuses
        </Button>
      </ToolbarGroup>

      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder="Search title or description"
        aria-label="Search delivery items"
        className="w-full md:max-w-xs"
      />
    </Toolbar>
  );
}
