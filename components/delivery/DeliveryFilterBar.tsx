"use client";

import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { SpeciesId } from "@/lib/config/species";

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
}

// Flows are not deliverables (their status is a rollup of their views), so the
// board offers the item-bearing species. Views are the default lens;
// acceptances are the atomic parity unit (spec §9.3).
const SPECIES_OPTIONS: { id: SpeciesId; label: string }[] = [
  { id: "view", label: "Views" },
  { id: "acceptance", label: "Acceptances" },
  { id: "api-endpoint", label: "API Endpoints" },
  { id: "data-model", label: "Data Models" },
];

export function DeliveryFilterBar({
  platform,
  species,
  showAllStatuses,
  search,
  onPlatformChange,
  onToggleSpecies,
  onShowAllStatusesChange,
  onSearchChange,
}: DeliveryFilterBarProps) {
  return (
    <div className="rounded-xl border bg-card/70 p-3 md:p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Platform</span>
            <Button
              type="button"
              variant={platform === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => onPlatformChange("all")}
            >
              All
            </Button>
            {PLATFORMS.map((option) => (
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Species</span>
            {SPECIES_OPTIONS.map((option) => (
              <Button
                key={option.id}
                type="button"
                variant={species.includes(option.id) ? "default" : "outline"}
                size="sm"
                aria-pressed={species.includes(option.id)}
                onClick={() => onToggleSpecies(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <Button
            type="button"
            variant={showAllStatuses ? "default" : "outline"}
            size="sm"
            aria-pressed={showAllStatuses}
            onClick={() => onShowAllStatusesChange(!showAllStatuses)}
          >
            All statuses
          </Button>
        </div>

        <div className="relative w-full md:max-w-md">
          <SearchIcon className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search title or description"
            className="pl-8"
            aria-label="Search delivery items"
          />
        </div>
      </div>
    </div>
  );
}
