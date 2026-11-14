"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarRangeIcon,
  CircleFadingArrowUpIcon,
  LayersIcon,
  ListChevronsDownUpIcon,
  ListChevronsUpDownIcon,
  type LucideIcon,
} from "lucide-react";
import { Toolbar, ToolbarGroup } from "@/components/layout/Toolbar";
import { ExpandableSearch } from "@/components/layout/ExpandableSearch";
import { FilterSelectTrigger } from "@/components/layout/FilterSelectTrigger";
import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import { DECISION_STATUS_ICONS } from "@/components/graph/nodes/node-styles";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DECISION_STATUSES, type DecisionStatusId } from "@/lib/config/decision-statuses";
import type { DecisionGrouping } from "@/lib/hooks/useDisplayPreferences";
import { GUARDED_HOTKEY, toolbarKey, useShortcut } from "@/lib/hooks/useShortcut";
import type { DecisionLogModel, DecisionStatusFilter } from "@/lib/utils/decision-log";

// The filter value lives with the log model that reads it; re-exported for the page.
export type { DecisionStatusFilter };

/** The "no filter" value. Already a real string, so Radix's Select can hold it. */
const ALL = "all";

/**
 * Below this toolbar width the bar compacts. The full bar — a 14rem search,
 * seven status keys, the grouping switch and the detail toggle — needs about
 * 55rem on one row. An open panel takes the page under that on a laptop, and
 * so does a narrow window: the bar answers its own width, not "is a panel
 * open", so both fold the same way.
 */
const COMPACT_BELOW_PX = 880;

interface DecisionFilterBarProps {
  search: string;
  onSearchChange: (query: string) => void;
  status: DecisionStatusFilter;
  onStatusChange: (status: DecisionStatusFilter) => void;
  /** Total decisions, for "All". */
  total: number;
  /** How many decisions carry each status, in the vocabulary's order (the log model's `counts`). */
  counts: DecisionLogModel["counts"];
  /** True while every decision shows its rationale and its edge chips. */
  detailed: boolean;
  onDetailedChange: (detailed: boolean) => void;
  /** How the log is grouped: by quarter (a timeline) or by status. */
  grouping: DecisionGrouping;
  onGroupingChange: (grouping: DecisionGrouping) => void;
}

/**
 * The Decision Log's toolbar: find a decision, narrow by status, choose how the
 * log is grouped and how much of each decision it shows.
 *
 * **Two widths, one set of controls.** With room, status is a connected group
 * of keys — "All 49", then each status's glyph and count, the chosen one
 * widening with its word — so the counts are read at rest, beside the search.
 * Narrowed (a panel open, a small window), the bar folds to one row: the search
 * rests as an icon that opens into the field ({@link ExpandableSearch}), and
 * the keys become the status menu, whose entries carry the same counts
 * ("Proposed · 2"). Measured on the bar itself (a probe absolutely placed
 * inside it: `Toolbar` takes no ref), so it never depends on knowing what else
 * shares the row.
 *
 * The detail toggle is the Changelog's, down to the glyph pair: both surfaces
 * are a timeline whose entries carry prose under the title, and a reader
 * scanning for one decision among forty wants the same fold there as here.
 */
export function DecisionFilterBar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  total,
  counts,
  detailed,
  onDetailedChange,
  grouping,
  onGroupingChange,
}: DecisionFilterBarProps) {
  const toggleLabel = detailed ? "Collapse decision details" : "Expand decision details";
  useShortcut("toggle-expand", toolbarKey(() => onDetailedChange(!detailed)), GUARDED_HOTKEY);

  const probeRef = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < COMPACT_BELOW_PX));
    observer.observe(probe);
    return () => observer.disconnect();
  }, []);

  const detailToggle = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-pressed={detailed}
          aria-label={toggleLabel}
          onClick={() => onDetailedChange(!detailed)}
          // A tonal pill like the controls beside it; "on" settles into a
          // squircle (app/m3/controls.css): this button sets no value, it opens
          // and shuts the prose and chips under each decision.
        >
          {detailed ? <ListChevronsDownUpIcon className="size-4" /> : <ListChevronsUpDownIcon className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{toggleLabel}</TooltipContent>
    </Tooltip>
  );

  return (
    // `dc-toolbar-is-keys` only on the full bar: below 40rem it gives the keys
    // a row of their own, which the compact bar's grouping switch must not get.
    <Toolbar className={compact ? "dc-toolbar" : "dc-toolbar dc-toolbar-is-keys"}>
      <span ref={probeRef} className="dc-toolbar-probe" aria-hidden="true" />
      {compact ? (
        <>
          <ToolbarGroup>
            <ExpandableSearch value={search} onChange={onSearchChange} placeholder="Search decisions…" aria-label="Search decisions" />
          </ToolbarGroup>
          <ToolbarGroup>
            <Select value={status} onValueChange={(value) => onStatusChange(value === ALL ? "all" : (value as DecisionStatusId))}>
              <FilterSelectTrigger
                icon={<CircleFadingArrowUpIcon />}
                label="Status"
                active={status !== "all"}
                valueLabel={DECISION_STATUSES.find((entry) => entry.id === status)?.label}
              />
              <SelectContent align="start">
                <SelectItem value={ALL}>All statuses · {total}</SelectItem>
                {/* The shared vocabulary, so a status reads here in the same
                    glyph and colour it wears on the log and in its panel. */}
                <StatusSelectItems vocabulary="decision-status" counts={new Map(counts.map((c) => [c.status, c.count]))} />
              </SelectContent>
            </Select>
            <GroupingSwitch grouping={grouping} onGroupingChange={onGroupingChange} iconOnly />
            {detailToggle}
          </ToolbarGroup>
        </>
      ) : (
        <>
          <ToolbarGroup className="dc-toolbar-search w-full flex-[1_1_14rem] md:max-w-xs">
            <SearchInput
              value={search}
              onChange={onSearchChange}
              placeholder="Search decisions…"
              aria-label="Search decisions"
              className="min-w-0 flex-1"
            />
          </ToolbarGroup>
          <ToolbarGroup className="dc-toolbar-end">
            <StatusKeys total={total} counts={counts} status={status} onStatusChange={onStatusChange} />
            <GroupingSwitch grouping={grouping} onGroupingChange={onGroupingChange} />
            {detailToggle}
          </ToolbarGroup>
        </>
      )}
    </Toolbar>
  );
}

/**
 * The status filter as one connected group of keys: glyph and count at rest,
 * the chosen key widening with its word; a second press on it lets go.
 */
function StatusKeys({
  total,
  counts,
  status,
  onStatusChange,
}: Pick<DecisionFilterBarProps, "total" | "counts" | "status" | "onStatusChange">) {
  return (
    <div role="group" aria-label="Filter by status" className="dc-connected">
      <button type="button" aria-pressed={status === "all"} aria-label={`All statuses (${total})`} onClick={() => onStatusChange("all")}>
        <span className="dc-connected-label" data-always="">
          All
        </span>
        <span className="dc-num">{total}</span>
      </button>
      {counts.map(({ status: id, label, count }) => {
        const Icon = DECISION_STATUS_ICONS[id];
        const chosen = status === id;
        const button = (
          <button
            key={id}
            type="button"
            data-dc-status={id}
            data-zero={count === 0 ? "" : undefined}
            aria-pressed={chosen}
            aria-label={`${label} (${count})`}
            onClick={() => onStatusChange(chosen ? "all" : id)}
          >
            <Icon aria-hidden="true" />
            {chosen && <span className="dc-connected-label">{label}</span>}
            <span className="dc-num">{count}</span>
          </button>
        );
        if (chosen) return button;
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

const GROUPINGS: { id: DecisionGrouping; label: string; Icon: LucideIcon }[] = [
  { id: "quarter", label: "By quarter", Icon: CalendarRangeIcon },
  { id: "status", label: "By status", Icon: LayersIcon },
];

/** Quarter | Status as two connected keys; the chosen one says its word unless the bar is compact. */
function GroupingSwitch({
  grouping,
  onGroupingChange,
  iconOnly = false,
}: {
  grouping: DecisionGrouping;
  onGroupingChange: (grouping: DecisionGrouping) => void;
  iconOnly?: boolean;
}) {
  return (
    <div role="group" aria-label="Group decisions" className="dc-connected">
      {GROUPINGS.map(({ id, label, Icon }) => {
        const chosen = grouping === id;
        const worded = chosen && !iconOnly;
        const button = (
          <button key={id} type="button" aria-pressed={chosen} aria-label={label} onClick={() => onGroupingChange(id)}>
            <Icon aria-hidden="true" />
            {worded && <span className="dc-connected-label">{label}</span>}
          </button>
        );
        if (worded) return button;
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
