"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import type { ProjectBundle } from "@/lib/data/types";
import type { AcceptanceFilters } from "@/lib/utils/acceptance-matrix";
import { EMPTY_FILTERS } from "@/lib/utils/acceptance-matrix";
import { PLATFORMS } from "@/lib/config/platforms";
import { STATUSES } from "@/lib/config/statuses";
import { VALUES } from "@/lib/config/values";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { Input } from "@/components/ui/input";
import { ProductOverrideSelector } from "@/components/layout/ProductOverrideSelector";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PLATFORM_ICONS, STATUS_ICONS, STATUS_STYLES } from "@/components/graph/nodes/node-styles";
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
  const scope = useEffectiveProduct(projectId, project);
  // The same arity rule the matrix reads for its columns: a control that can
  // only ever say "Web" is not a choice, it is the scope repeated. A project
  // declaring no products resolves to every platform, so this is today's bar.
  const showPlatformFilter = scope.isMultiPlatform;
  const platformOptions = useMemo(
    () => PLATFORMS.filter((platform) => scope.platforms.includes(platform.id)),
    [scope],
  );

  // A stale platform filter must not outlive the control that could clear it:
  // scoped to a web-only product, `platform=android` would silently empty the
  // list with nothing on screen to explain why. Reset through the same
  // `onChange` the control uses, so the URL stays the one source of truth. The
  // early return makes this idempotent — the echo back through `filters` is
  // already `"all"`, so it cannot loop.
  useEffect(() => {
    if (showPlatformFilter || filters.platform === ALL) return;
    onChange({ ...filters, platform: "all" });
  }, [showPlatformFilter, filters, onChange]);

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
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 md:p-4">
      <ProductOverrideSelector projectId={projectId} project={project} />
      <div className="relative min-w-[12rem] flex-1">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Search acceptances…"
          className="pl-8"
          aria-label="Search acceptances"
        />
      </div>

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
          {STATUSES.map((s) => {
            const Icon = STATUS_ICONS[s.id];
            return <SelectItem key={s.id} value={s.id}><span className="inline-flex items-center gap-2"><Icon className={`size-3.5 ${STATUS_STYLES[s.id].badge}`} />{s.label}</span></SelectItem>;
          })}
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
    </div>
  );
}
