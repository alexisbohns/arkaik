"use client";

import { useEffect, useRef, useState } from "react";
import { TriangleAlertIcon, XIcon } from "lucide-react";
import type { ProjectBundle } from "@/lib/data/types";
import type { AcceptanceFilters } from "@/lib/utils/acceptance-matrix";
import { EMPTY_FILTERS, UNANCHORED_FILTER } from "@/lib/utils/acceptance-matrix";
import { VALUES } from "@/lib/config/values";
import { usePlatformFilterControl } from "@/lib/hooks/usePlatformFilterControl";
import { SearchInput } from "@/components/ui/search-input";
import { ProductOverrideSelector } from "@/components/layout/ProductOverrideSelector";
import { Toolbar, ToolbarGroup } from "@/components/layout/Toolbar";
import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PLATFORM_ICONS } from "@/components/graph/nodes/node-styles";
import { VALUE_ICON_COMPONENTS } from "@/lib/config/value-icons";

interface AnchorOption {
  id: string;
  title: string;
}

interface AcceptanceFilterBarProps {
  filters: AcceptanceFilters;
  onChange: (next: AcceptanceFilters) => void;
  anchorOptions: AnchorOption[];
  projectId: string;
  /** The bundle products live on. `undefined` until `useProject` resolves. */
  project: ProjectBundle | undefined;
}

const ALL = "all";

export function AcceptanceFilterBar({ filters, onChange, anchorOptions, projectId, project }: AcceptanceFilterBarProps) {
  // Same arity rule and same stale-filter reset as the Delivery bar; only the
  // rendering below (a Select, not toggle buttons) is this bar's own. Cleared
  // through the same `onChange` the control uses, so the URL stays the one
  // source of truth.
  const { showPlatformFilter, platformOptions } = usePlatformFilterControl(
    projectId,
    project,
    filters.platform,
    () => onChange({ ...filters, platform: "all" }),
  );

  const isFiltered =
    filters.search !== "" || filters.platform !== "all" || filters.status !== "all" ||
    filters.value !== "all" || filters.anchor !== "all" || filters.parityGap;

  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [syncedSearch, setSyncedSearch] = useState(filters.search);
  // What we last wrote ourselves via the debounced onChange below. Tracked as
  // state (not a ref) because it must be *read* during the render-time draft
  // adjustment, and react-hooks/refs forbids reading ref values during render
  // just as it forbids writing them.
  const [lastWrittenSearch, setLastWrittenSearch] = useState(filters.search);
  const filtersRef = useRef(filters);
  // Keep the ref current without mutating it during render (react-hooks/refs).
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  // Reflect external search changes (Clear, back/forward) into the draft. Adjusted
  // during render (React's documented pattern) rather than in an effect, since an
  // effect that just mirrors a prop into state trips react-hooks/set-state-in-effect.
  if (filters.search !== syncedSearch) {
    setSyncedSearch(filters.search);
    // Only reset the visible draft on an EXTERNAL change (Clear, back/forward),
    // not when our own debounced write echoes back through the URL — otherwise
    // characters typed during the round-trip gap get reverted.
    if (filters.search !== lastWrittenSearch) {
      setSearchDraft(filters.search);
    }
  }
  // Debounce draft → URL so typing stays responsive and doesn't drop characters.
  // Self-echo correctness relies on router.replace running as a transition (App
  // Router default): the plain setLastWrittenSearch below commits on the default
  // lane before the searchParams echo, so the guard never mistakes it for external.
  useEffect(() => {
    if (searchDraft === filtersRef.current.search) return;
    const t = setTimeout(() => {
      setLastWrittenSearch(searchDraft);
      onChange({ ...filtersRef.current, search: searchDraft });
    }, 300);
    return () => clearTimeout(t);
  }, [searchDraft, onChange]);

  return (
    <Toolbar>
      <ToolbarGroup className="w-full flex-1 md:max-w-sm">
        <ProductOverrideSelector projectId={projectId} project={project} />
        <SearchInput
          value={searchDraft}
          onChange={setSearchDraft}
          placeholder="Search acceptances…"
          aria-label="Search acceptances"
          className="min-w-0 flex-1"
        />
      </ToolbarGroup>

      {/* Seven controls is a lot for one band, so the four "narrow it" menus and
          the two toggles stay one group: they wrap together against the right
          edge instead of each finding its own line. */}
      <ToolbarGroup>
        {showPlatformFilter && (
          <Select value={filters.platform} onValueChange={(v) => onChange({ ...filters, platform: v === ALL ? "all" : (v as AcceptanceFilters["platform"]) })}>
            <SelectTrigger className="w-[8rem]" aria-label="Platform"><SelectValue placeholder="Platforms" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Platforms</SelectItem>
              {platformOptions.map((p) => {
                const Icon = PLATFORM_ICONS[p.id];
                return <SelectItem key={p.id} value={p.id}><span className="inline-flex items-center gap-2"><Icon className="size-3.5" />{p.label}</span></SelectItem>;
              })}
            </SelectContent>
          </Select>
        )}

        <Select value={filters.status} onValueChange={(v) => onChange({ ...filters, status: v === ALL ? "all" : (v as AcceptanceFilters["status"]) })}>
          <SelectTrigger className="w-[9rem]" aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <StatusSelectItems />
          </SelectContent>
        </Select>

        <Select value={filters.value} onValueChange={(v) => onChange({ ...filters, value: v === ALL ? "all" : (v as AcceptanceFilters["value"]) })}>
          <SelectTrigger className="w-[11rem]" aria-label="Value"><SelectValue placeholder="Value" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All values</SelectItem>
            {VALUES.map((v) => {
              const Icon = VALUE_ICON_COMPONENTS[v.id];
              return <SelectItem key={v.id} value={v.id}><span className="inline-flex items-center gap-2"><Icon className="size-3.5" />{v.label}</span></SelectItem>;
            })}
          </SelectContent>
        </Select>

        <Select value={filters.anchor} onValueChange={(v) => onChange({ ...filters, anchor: v === ALL ? "all" : v })}>
          <SelectTrigger className="w-[11rem]" aria-label="Anchor"><SelectValue placeholder="Anchor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All anchors</SelectItem>
            {/* The intake inbox: ideas filed before their flows and views exist.
                First, not sorted in among the anchors, because it is the one entry
                here that names an absence rather than a node. */}
            <SelectItem value={UNANCHORED_FILTER}>Unanchored (intake)</SelectItem>
            {anchorOptions.map((a) => <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>)}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant={filters.parityGap ? "default" : "outline"}
          aria-pressed={filters.parityGap}
          onClick={() => onChange({ ...filters, parityGap: !filters.parityGap })}
          className={filters.parityGap ? "bg-amber-500 text-white hover:bg-amber-500/90" : "text-amber-600 hover:text-amber-700"}
        >
          <TriangleAlertIcon className="size-4" /> Parity gaps
        </Button>

        {isFiltered && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setSearchDraft(""); onChange(EMPTY_FILTERS); }}
            aria-label="Clear filters"
          >
            <XIcon className="size-4" /> Clear
          </Button>
        )}
      </ToolbarGroup>
    </Toolbar>
  );
}
