"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownWideNarrowIcon,
  CircleDotIcon,
  FlagIcon,
  LayersIcon,
  ShapesIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import {
  FINDING_PRIORITIES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  type KritikDomain,
  type SurfaceDef,
} from "@arkaik/schema";
import { EMPTY_QUALITY_FILTERS, parseCellKey } from "@/lib/utils/quality";
import type { QualityFilters, QualitySort } from "@/lib/utils/quality";
import { QUALITY_SORTS } from "@/components/quality/quality-filters";
import { SearchInput } from "@/components/ui/search-input";
import { Toolbar, ToolbarGroup } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { FilterSelectTrigger } from "@/components/layout/FilterSelectTrigger";
import { cn } from "@/lib/utils";
import {
  FINDING_STATUS_LABEL,
  PRIORITY_CHIP,
  SEVERITY_DOT,
  SEVERITY_LABEL,
} from "@/components/quality/quality-styles";

interface QualityFilterBarProps {
  filters: QualityFilters;
  onChange: (next: QualityFilters) => void;
  /** The project's audit targets, from its profile — never a constant. */
  surfaces: SurfaceDef[];
  /** The pack's domains, in pack order, so the menu matches the matrix's rows. */
  domains: KritikDomain[];
}

const ALL = "all";

/** How the sort axis is worded in the menu; the ids themselves are terse. */
const SORT_LABELS: Record<QualitySort, string> = {
  severity: "Severity",
  priority: "Priority",
  surface: "Surface",
  domain: "Domain",
};

/**
 * The options that can actually be picked.
 *
 * A `SurfaceDef` or a `KritikDomain` with a blank id is not a filter anybody
 * can apply — `""` is the one value `filterFindings` reads as "do not narrow"
 * — and Radix throws outright on a `SelectItem` with an empty `value`. A
 * hand-edited profile is a supported input here, so the menu drops the entry
 * rather than the page.
 */
function namedSurfaces(surfaces: SurfaceDef[]): SurfaceDef[] {
  return surfaces.filter((surface) => typeof surface?.id === "string" && surface.id !== "");
}

function namedDomains(domains: KritikDomain[]): KritikDomain[] {
  return domains.filter((domain) => typeof domain?.code === "string" && domain.code !== "");
}

/** A surface's title as the profile writes it, falling back to its raw id. */
function surfaceTitleOf(surface: string, surfaces: SurfaceDef[]): string {
  return surfaces.find((candidate) => candidate?.id === surface)?.title ?? surface;
}

/** A domain's name as the pack writes it, falling back to its code. */
function domainNameOf(domain: string, domains: KritikDomain[]): string {
  return domains.find((candidate) => candidate?.code === domain)?.name ?? domain;
}

/**
 * The findings bar: one search box, five narrowing menus, a sort, and the
 * matrix cell when one is open.
 *
 * Square icon-button menus throughout, the treatment from #374 — the band
 * carries six controls and the Quality page can be squeezed by two open panels,
 * so a row of `w-11rem` triggers each reading "All severities" would wrap into
 * a column of labels pretending to be values. The name lives in the tooltip and
 * in `aria-label`; a set value darkens the trigger and is spelled out in the
 * tooltip's second line.
 */
export function QualityFilterBar({ filters, onChange, surfaces, domains }: QualityFilterBarProps) {
  const cell = parseCellKey(filters.cell);

  const isFiltered =
    filters.search !== "" ||
    filters.severity !== "all" ||
    filters.priority !== "all" ||
    filters.surface !== "all" ||
    filters.domain !== "all" ||
    filters.status !== "all" ||
    filters.cell !== null ||
    filters.sort !== EMPTY_QUALITY_FILTERS.sort;

  // The search field's own copy of the text, debounced into the URL. Lifted
  // wholesale from `AcceptanceFilterBar`, including the self-echo guard, and
  // for the same reason: a URL write per keystroke round-trips through the App
  // Router and drops characters typed during the gap.
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [syncedSearch, setSyncedSearch] = useState(filters.search);
  // What we last wrote ourselves. State, not a ref, because it is *read* during
  // the render-time draft adjustment below, and react-hooks/refs forbids
  // reading ref values during render just as it forbids writing them.
  const [lastWrittenSearch, setLastWrittenSearch] = useState(filters.search);
  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  // Reflect external search changes (Clear, back/forward) into the draft.
  // Adjusted during render, React's documented pattern for state derived from a
  // prop, rather than in an effect that would trip react-hooks/set-state-in-effect.
  if (filters.search !== syncedSearch) {
    setSyncedSearch(filters.search);
    // Only on an EXTERNAL change — our own debounced write echoing back through
    // the URL must not revert characters typed during the round-trip.
    if (filters.search !== lastWrittenSearch) {
      setSearchDraft(filters.search);
    }
  }

  useEffect(() => {
    if (searchDraft === filtersRef.current.search) return;
    const timer = setTimeout(() => {
      setLastWrittenSearch(searchDraft);
      onChange({ ...filtersRef.current, search: searchDraft });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft, onChange]);

  return (
    <Toolbar>
      <ToolbarGroup className="w-full flex-1 md:max-w-sm">
        <SearchInput
          value={searchDraft}
          onChange={setSearchDraft}
          placeholder="Search findings…"
          aria-label="Search findings"
          className="min-w-0 flex-1"
        />
        {/*
          The open matrix cell, as a chip rather than a seventh menu: it is set
          by clicking the matrix above, never by picking it here, and its
          dismiss clears `cell` alone. Clearing it through the whole bar would
          throw away a search somebody ran inside the cell they were reading.
        */}
        {cell && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-accent px-2 py-1 text-xs dark:bg-accent/50">
            <span className="font-medium">{domainNameOf(cell.domain, domains)}</span>
            <span className="text-muted-foreground">×</span>
            <span>{surfaceTitleOf(cell.surface, surfaces)}</span>
            <button
              type="button"
              onClick={() => onChange({ ...filters, cell: null })}
              aria-label="Clear the selected cell"
              className="-me-1 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        )}
      </ToolbarGroup>

      {/* Six controls in one group so they wrap together against the right edge
          instead of each finding its own line on a narrowed surface. */}
      <ToolbarGroup>
        <Select
          value={filters.severity}
          onValueChange={(value) =>
            onChange({ ...filters, severity: value === ALL ? "all" : (value as QualityFilters["severity"]) })
          }
        >
          <FilterSelectTrigger
            icon={<TriangleAlertIcon />}
            label="Severity"
            active={filters.severity !== "all"}
            valueLabel={filters.severity === "all" ? undefined : SEVERITY_LABEL[filters.severity]}
          />
          <SelectContent align="start">
            <SelectItem value={ALL}>All severities</SelectItem>
            {FINDING_SEVERITIES.map((severity) => (
              <SelectItem key={severity} value={severity}>
                <span className="inline-flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", SEVERITY_DOT[severity])} aria-hidden="true" />
                  {SEVERITY_LABEL[severity]}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.priority}
          onValueChange={(value) =>
            onChange({ ...filters, priority: value === ALL ? "all" : (value as QualityFilters["priority"]) })
          }
        >
          <FilterSelectTrigger
            icon={<FlagIcon />}
            label="Priority"
            active={filters.priority !== "all"}
            valueLabel={filters.priority === "all" ? undefined : filters.priority}
          />
          <SelectContent align="start">
            <SelectItem value={ALL}>All priorities</SelectItem>
            {FINDING_PRIORITIES.map((priority) => (
              <SelectItem key={priority} value={priority}>
                <span className="inline-flex items-center gap-2">
                  <span className={cn("rounded border px-1 text-[10px] font-medium", PRIORITY_CHIP[priority])}>
                    {priority}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.surface}
          onValueChange={(value) => onChange({ ...filters, surface: value === ALL ? "all" : value })}
        >
          <FilterSelectTrigger
            icon={<LayersIcon />}
            label="Surface"
            active={filters.surface !== "all"}
            valueLabel={filters.surface === "all" ? undefined : surfaceTitleOf(filters.surface, surfaces)}
          />
          <SelectContent align="start">
            <SelectItem value={ALL}>All surfaces</SelectItem>
            {namedSurfaces(surfaces).map((surface) => (
              <SelectItem key={surface.id} value={surface.id}>
                {surface.title ?? surface.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.domain}
          onValueChange={(value) => onChange({ ...filters, domain: value === ALL ? "all" : value })}
        >
          <FilterSelectTrigger
            icon={<ShapesIcon />}
            label="Domain"
            active={filters.domain !== "all"}
            valueLabel={filters.domain === "all" ? undefined : domainNameOf(filters.domain, domains)}
          />
          <SelectContent align="start">
            <SelectItem value={ALL}>All domains</SelectItem>
            {namedDomains(domains).map((domain) => (
              <SelectItem key={domain.code} value={domain.code}>
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">{domain.code}</span>
                  {domain.name ?? domain.code}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.status}
          onValueChange={(value) =>
            onChange({ ...filters, status: value === ALL ? "all" : (value as QualityFilters["status"]) })
          }
        >
          <FilterSelectTrigger
            icon={<CircleDotIcon />}
            label="Status"
            active={filters.status !== "all"}
            valueLabel={filters.status === "all" ? undefined : FINDING_STATUS_LABEL[filters.status]}
          />
          <SelectContent align="start">
            <SelectItem value={ALL}>All statuses</SelectItem>
            {FINDING_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {FINDING_STATUS_LABEL[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* The sort has no "all", so its trigger reads active whenever the order
            is not the default — the same rule the menus beside it follow, told
            against `EMPTY_QUALITY_FILTERS` instead of against the word. */}
        <Select value={filters.sort} onValueChange={(value) => onChange({ ...filters, sort: value as QualitySort })}>
          <FilterSelectTrigger
            icon={<ArrowDownWideNarrowIcon />}
            label="Sort"
            active={filters.sort !== EMPTY_QUALITY_FILTERS.sort}
            valueLabel={SORT_LABELS[filters.sort]}
          />
          <SelectContent align="start">
            {QUALITY_SORTS.map((sort) => (
              <SelectItem key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isFiltered && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchDraft("");
              onChange(EMPTY_QUALITY_FILTERS);
            }}
            aria-label="Clear filters"
          >
            <XIcon className="size-4" /> Clear
          </Button>
        )}
      </ToolbarGroup>
    </Toolbar>
  );
}
