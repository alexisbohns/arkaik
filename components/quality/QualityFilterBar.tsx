"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownWideNarrowIcon,
  CircleDotIcon,
  LayersIcon,
  ShapesIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import {
  FINDING_PRIORITIES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  type FindingPriority,
  type KritikDomain,
  type SurfaceDef,
} from "@arkaik/schema";
import { DEFAULT_QUALITY_FILTERS, parseCellKey } from "@/lib/utils/quality";
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
  PRIORITY_HINT,
  SEVERITY_DOT,
  SEVERITY_LABEL,
} from "@/components/quality/quality-styles";
import { GUARDED_HOTKEY, toolbarKey, useShortcut } from "@/lib/hooks/useShortcut";

interface QualityFilterBarProps {
  filters: QualityFilters;
  onChange: (next: QualityFilters) => void;
  /** The project's audit targets, from its profile — never a constant. */
  surfaces: SurfaceDef[];
  /** The pack's domains, in pack order, so the menu matches the matrix's rows. */
  domains: KritikDomain[];
}

const ALL = "all";

/** The priority row's keys: every lane, then each lane in the pack's order. */
const PRIORITY_KEYS: readonly ("all" | FindingPriority)[] = [ALL, ...FINDING_PRIORITIES];

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
 * The findings bar: one search box, four narrowing menus, a sort, and the
 * matrix cell when one is open — then, on a row of its own, the priority.
 *
 * Icon-button menus, the treatment from #374 — the band carries six controls
 * and the Quality page can be squeezed by two open panels, so a row of
 * `w-11rem` triggers each reading "All severities" would wrap into a column of
 * labels pretending to be values. The name lives in the tooltip and in
 * `aria-label`; a set value lifts its key out of the connected group
 * (`app/m3/quality.css`) and is spelled out in the tooltip's second line.
 *
 * Priority is not a menu among them. It is the one filter a reader triages
 * by — the lanes below are its lanes — so it is a connected group of keys
 * under the bar, every lane in its own tone and always in view, the chosen one
 * lifting out with what it means ("P1 Next milestone"). Said once: there is no
 * Priority menu as well.
 */
export function QualityFilterBar({ filters, onChange, surfaces, domains }: QualityFilterBarProps) {
  const cell = parseCellKey(filters.cell);

  const isFiltered =
    filters.search !== "" ||
    filters.severity !== "all" ||
    filters.priority !== "all" ||
    filters.surface !== "all" ||
    filters.domain !== "all" ||
    filters.status !== DEFAULT_QUALITY_FILTERS.status ||
    filters.cell !== null ||
    filters.sort !== DEFAULT_QUALITY_FILTERS.sort;

  // The search field's own copy of the text, debounced into the URL. Lifted
  // wholesale from `AcceptanceFilterBar`, including the self-echo guard, and
  // for the same reason: a URL write per keystroke round-trips through the App
  // Router and drops characters typed during the gap.
  const [searchDraft, setSearchDraft] = useState(filters.search);
  // The Clear button's own handler, so the key and the button cannot disagree.
  const clearFilters = () => {
    setSearchDraft("");
    onChange(DEFAULT_QUALITY_FILTERS);
  };
  useShortcut("clear-filters", toolbarKey(clearFilters), { ...GUARDED_HOTKEY, enabled: isFiltered });
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
    <div className="kq-scope kq-tb">
      <Toolbar>
        <ToolbarGroup className="w-full flex-[1_1_16rem] md:max-w-sm">
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
            <span
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-(--md-secondary-container) ps-3 pe-1.5 text-xs text-(--md-on-secondary-container)"
              /* Both halves are truncated below, and this is where the untrimmed
                 pair still reads. */
              title={`${domainNameOf(cell.domain, domains)} × ${surfaceTitleOf(cell.surface, surfaces)}`}
            >
              {/* Bounded, because a domain name is the pack's to write and this
                  pack's run to "Agentic Development Readiness": the chip does not
                  shrink, so an unbounded name inside a group capped at
                  `md:max-w-sm` squeezes the search box beside it toward nothing.
                  The name and not the code — the code names nothing to a reader
                  who has not read the pack, and the matrix cell this chip echoes
                  was clicked under its name. */}
              <span className="max-w-[10rem] truncate font-medium">{domainNameOf(cell.domain, domains)}</span>
              <span className="opacity-70">×</span>
              <span className="max-w-[8rem] truncate">{surfaceTitleOf(cell.surface, surfaces)}</span>
              <button
                type="button"
                onClick={() => onChange({ ...filters, cell: null })}
                aria-label="Clear the selected cell"
                className="grid size-6 cursor-pointer place-items-center rounded-full transition-colors hover:bg-(--md-on-secondary-container)/10 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-(--md-secondary)"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          )}
        </ToolbarGroup>

        {/* Five controls in one group so they wrap together against the right edge
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
              /* The one menu that reads its value out even while unset: the
                 board hides decided findings by default, and a trigger that
                 looked exactly like "All statuses" would leave a reader hunting
                 for a P0 they resolved with nothing on screen admitting it. */
              active={filters.status !== DEFAULT_QUALITY_FILTERS.status}
              valueLabel={filters.status === "all" ? "All" : FINDING_STATUS_LABEL[filters.status]}
              forceValueLabel
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
              against `DEFAULT_QUALITY_FILTERS` instead of against the word. */}
          <Select value={filters.sort} onValueChange={(value) => onChange({ ...filters, sort: value as QualitySort })}>
            <FilterSelectTrigger
              icon={<ArrowDownWideNarrowIcon />}
              label="Sort"
              active={filters.sort !== DEFAULT_QUALITY_FILTERS.sort}
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
              onClick={clearFilters}
              aria-label="Clear filters"
            >
              <XIcon className="size-4" /> Clear
            </Button>
          )}
        </ToolbarGroup>
      </Toolbar>
      <div className="kq-tb-row">
        <div role="group" aria-label="Priority" className="kq-lanes-group">
          {PRIORITY_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filters.priority === key}
              data-kq-priority={key === ALL ? undefined : key}
              onClick={() => onChange({ ...filters, priority: key })}
              title={key === ALL ? "Every priority" : `${key} — ${PRIORITY_HINT[key]}`}
            >
              <span className="kq-lanes-key">{key === ALL ? "All" : key}</span>
              {key !== ALL && <span className="kq-lanes-hint">{PRIORITY_HINT[key]}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
