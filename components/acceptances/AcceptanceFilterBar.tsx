"use client";

import { SearchIcon, XIcon } from "lucide-react";
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
  const isFiltered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[12rem] flex-1">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
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
        className={filters.parityGap ? "bg-amber-500 text-white hover:bg-amber-500/90" : "text-amber-600"}
      >
        ⚠ Parity gaps
      </Button>

      {isFiltered && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)} aria-label="Clear filters">
          <XIcon className="size-4" /> Clear
        </Button>
      )}
    </div>
  );
}
