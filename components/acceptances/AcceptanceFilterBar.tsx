"use client";

import { useEffect, useRef, useState } from "react";
import { SearchIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import type { AcceptanceFilters } from "@/lib/utils/acceptance-matrix";
import { EMPTY_FILTERS } from "@/lib/utils/acceptance-matrix";
import { PLATFORMS } from "@/lib/config/platforms";
import { STATUSES } from "@/lib/config/statuses";
import { VALUES } from "@/lib/config/values";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AnchorOption {
  id: string;
  title: string;
}

interface AcceptanceFilterBarProps {
  filters: AcceptanceFilters;
  onChange: (next: AcceptanceFilters) => void;
  anchorOptions: AnchorOption[];
}

const ALL = "all";

export function AcceptanceFilterBar({ filters, onChange, anchorOptions }: AcceptanceFilterBarProps) {
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
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/70 p-3 md:p-4">
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

      <Select value={filters.platform} onValueChange={(v) => onChange({ ...filters, platform: v === ALL ? "all" : (v as AcceptanceFilters["platform"]) })}>
        <SelectTrigger className="w-[8rem]" aria-label="Platform"><SelectValue placeholder="Platform" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All platforms</SelectItem>
          {PLATFORMS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={filters.status} onValueChange={(v) => onChange({ ...filters, status: v === ALL ? "all" : (v as AcceptanceFilters["status"]) })}>
        <SelectTrigger className="w-[9rem]" aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          {STATUSES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={filters.value} onValueChange={(v) => onChange({ ...filters, value: v === ALL ? "all" : (v as AcceptanceFilters["value"]) })}>
        <SelectTrigger className="w-[11rem]" aria-label="Value"><SelectValue placeholder="Value" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All values</SelectItem>
          {VALUES.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}
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
