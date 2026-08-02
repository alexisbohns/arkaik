"use client";

import { useEffect, useMemo } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { SpeciesId } from "@/lib/config/species";
import type { ProjectBundle } from "@/lib/data/types";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";

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
  projectId,
  project,
}: DeliveryFilterBarProps) {
  const scope = useEffectiveProduct(projectId, project);
  // The same arity rule the board's columns read: a control that can only ever
  // say "Web" is not a choice, it is the scope repeated. A project declaring no
  // products resolves to every platform, so this is today's bar.
  const showPlatformFilter = scope.isMultiPlatform;
  const platformOptions = useMemo(
    () => PLATFORMS.filter((platform) => scope.platforms.includes(platform.id)),
    [scope],
  );

  // A stale platform filter must not outlive the control that could clear it:
  // scoped to a web-only product, `android` would silently empty the board with
  // nothing on screen to explain why. Reset through the same `onPlatformChange`
  // the buttons use. The early return makes this idempotent — the echo back
  // through `platform` is already `"all"`, so it cannot loop.
  useEffect(() => {
    if (showPlatformFilter || platform === "all") return;
    onPlatformChange("all");
  }, [showPlatformFilter, platform, onPlatformChange]);

  return (
    <div className="rounded-xl border bg-card/70 p-3 md:p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {showPlatformFilter && (
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
            </div>
          )}

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
