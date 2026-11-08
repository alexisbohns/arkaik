"use client";

import { Columns3Icon, Rows2Icon, Rows4Icon, ShapesIcon } from "lucide-react";
import { PLATFORM_ICONS, STATUS_ICONS, STATUS_LABELS, STATUS_STYLES } from "@/components/graph/nodes/node-styles";
import { ExpandableSearch } from "@/components/layout/ExpandableSearch";
import { FilterMenuTrigger, FilterSelectTrigger } from "@/components/layout/FilterSelectTrigger";
import { SelectedPlatformIcon } from "@/components/layout/SelectedPlatformIcon";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProductOverrideSelector } from "@/components/layout/ProductOverrideSelector";
import { Toolbar, ToolbarGroup } from "@/components/layout/Toolbar";
import type { PlatformId } from "@/lib/config/platforms";
import type { SpeciesId } from "@/lib/config/species";
import { DEFAULT_COUNTED_STATUS_PRESET_ID, getCountedStatuses, type StatusId } from "@/lib/config/statuses";
import { SPECIES_PLURALS } from "@/lib/config/species-icons";
import type { ProjectBundle } from "@/lib/data/types";
import { usePlatformFilterControl } from "@/lib/hooks/usePlatformFilterControl";
import { usePlatformHotkeys } from "@/lib/hooks/usePlatformHotkeys";
import { GUARDED_HOTKEY, toolbarKey, useShortcut } from "@/lib/hooks/useShortcut";

export type DeliveryPlatformFilter = "all" | PlatformId;

interface DeliveryFilterBarProps {
  platform: DeliveryPlatformFilter;
  species: readonly SpeciesId[];
  /** Every status column the reader can pick, in lifecycle order. */
  statusOptions: readonly StatusId[];
  /** The columns currently shown. */
  visibleStatuses: readonly StatusId[];
  search: string;
  onPlatformChange: (platform: DeliveryPlatformFilter) => void;
  onToggleSpecies: (species: SpeciesId) => void;
  onToggleStatus: (status: StatusId) => void;
  onSearchChange: (query: string) => void;
  /** One-line cards on the board. */
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
  projectId: string;
  /** The bundle products live on. `undefined` until `useProject` resolves. */
  project: ProjectBundle | undefined;
  /** The page's filters differ from its resting lens — `c` has something to clear. */
  isFiltered: boolean;
  /** Back to the resting lens. Keyboard-only for now (`c`); the bar has no Clear button. */
  onClearFilters: () => void;
}

// Flows are not deliverables (their status is a rollup of their views), so the
// board offers the item-bearing species, in the order they read on the board.
// Views are the default lens; acceptances are the atomic parity unit (spec
// §9.3). Labels come from the shared plural vocabulary — the sidebar, the
// palette and the Inventory card name these same four the same way.
/** The "no filter" value. Already a real string, so Radix's Select can hold it. */
const ALL = "all";

const SPECIES_OPTIONS = ["view", "acceptance", "api-endpoint", "data-model"] as const satisfies readonly SpeciesId[];

export function DeliveryFilterBar({
  platform,
  species,
  statusOptions,
  visibleStatuses,
  search,
  onPlatformChange,
  onToggleSpecies,
  onToggleStatus,
  onSearchChange,
  compact,
  onCompactChange,
  projectId,
  project,
  isFiltered,
  onClearFilters,
}: DeliveryFilterBarProps) {
  // Same arity rule and same stale-filter reset as the Acceptances bar, and now
  // the same rendering too — a Select behind an icon trigger.
  const { showPlatformFilter, platformOptions } = usePlatformFilterControl(
    projectId,
    project,
    platform,
    () => onPlatformChange("all"),
  );
  usePlatformHotkeys({
    enabled: showPlatformFilter,
    available: platformOptions,
    current: platform,
    onSelect: onPlatformChange,
  });
  useShortcut("clear-filters", toolbarKey(onClearFilters), { ...GUARDED_HOTKEY, enabled: isFiltered });

  const defaultSpecies = species.length === 1 && species[0] === "view";
  // The resting set is the counted preset; the trigger reads as set off it.
  const restingColumns = getCountedStatuses(DEFAULT_COUNTED_STATUS_PRESET_ID);
  const defaultColumns =
    visibleStatuses.length === restingColumns.length &&
    visibleStatuses.every((status) => restingColumns.includes(status));

  return (
    <Toolbar>
      {/* Icon menus, the shape every other filter band here uses: the scope,
          then what to narrow by, then the one toggle; search folds to an icon
          at the right edge. */}
      <ToolbarGroup>
        <ProductOverrideSelector projectId={projectId} project={project} />

        {showPlatformFilter && (
          <Select
            value={platform}
            onValueChange={(next) => onPlatformChange(next === ALL ? "all" : (next as DeliveryPlatformFilter))}
          >
            <FilterSelectTrigger
              icon={<SelectedPlatformIcon platform={platform} />}
              label="Platform"
              active={platform !== "all"}
              valueLabel={platformOptions.find((option) => option.id === platform)?.label}
            />
            <SelectContent align="start">
              <SelectItem value={ALL}>All platforms</SelectItem>
              {platformOptions.map((option) => {
                const Icon = PLATFORM_ICONS[option.id];
                return (
                  <SelectItem key={option.id} value={option.id}>
                    <span className="inline-flex items-center gap-2">
                      <Icon className="size-3.5" />
                      {option.label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}

        {/* A menu of checkboxes rather than a Select: the board shows several
            species at once, and a Select holds one value. */}
        <DropdownMenu>
          <FilterMenuTrigger
            icon={<ShapesIcon />}
            label="Species"
            active={!defaultSpecies}
            valueLabel={species.map((option) => SPECIES_PLURALS[option]).join(", ") || "None"}
          />
          <DropdownMenuContent align="start">
            {SPECIES_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option}
                checked={species.includes(option)}
                onCheckedChange={() => onToggleSpecies(option)}
                // Stay open: ticking three species is three clicks, not three
                // trips back to the trigger.
                onSelect={(event) => event.preventDefault()}
              >
                {SPECIES_PLURALS[option]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Which columns the board draws. Checkboxes for the reason species
            has them: several at once. The last column cannot be unticked — a
            board with no columns is a blank pane with no hint why. */}
        <DropdownMenu>
          <FilterMenuTrigger
            icon={<Columns3Icon />}
            label="Columns"
            active={!defaultColumns}
            valueLabel={visibleStatuses.map((status) => STATUS_LABELS[status]).join(", ")}
          />
          <DropdownMenuContent align="start">
            {statusOptions.map((status) => {
              const StatusIcon = STATUS_ICONS[status];
              const checked = visibleStatuses.includes(status);
              return (
                <DropdownMenuCheckboxItem
                  key={status}
                  checked={checked}
                  disabled={checked && visibleStatuses.length === 1}
                  onCheckedChange={() => onToggleStatus(status)}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span className="inline-flex items-center gap-2">
                    <StatusIcon className={`size-3.5 ${STATUS_STYLES[status].badge}`} aria-hidden="true" />
                    {STATUS_LABELS[status]}
                  </span>
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </ToolbarGroup>

      <ToolbarGroup>
        {/* How the cards draw, not what they show — so it sits with search on
            the right, apart from the filters. Border-only like the Decisions
            detail toggle: it sets no filter, and the glyph says which view is on. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-pressed={compact}
              aria-label={compact ? "Show detailed cards" : "Show compact cards"}
              onClick={() => onCompactChange(!compact)}
              className="cursor-pointer bg-transparent text-muted-foreground dark:bg-transparent"
            >
              {compact ? <Rows4Icon className="size-4" /> : <Rows2Icon className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{compact ? "Show detailed cards" : "Show compact cards"}</TooltipContent>
        </Tooltip>
        <ExpandableSearch
          value={search}
          onChange={onSearchChange}
          placeholder="Search title or description"
          aria-label="Search delivery items"
        />
      </ToolbarGroup>
    </Toolbar>
  );
}
