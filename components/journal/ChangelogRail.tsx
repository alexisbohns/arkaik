"use client";

import {
  CalendarIcon,
  CalendarRangeIcon,
  FilterXIcon,
  ListChevronsDownUpIcon,
  ListChevronsUpDownIcon,
} from "lucide-react";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { FilterSelectTrigger } from "@/components/layout/FilterSelectTrigger";
import { RailButton, RailGroup, RightRail } from "@/components/layout/RightRail";
import { GUARDED_HOTKEY, toolbarKey, useShortcut } from "@/lib/hooks/useShortcut";
import { MONTH_LABELS } from "@/lib/utils/changelog-period";

/** The "no filter" sentinel — Radix's Select cannot hold an empty string value. */
const ALL = "__all__";

interface ChangelogRailProps {
  /** Years present in the timeline, newest first. */
  years: readonly number[];
  year: number | null;
  month: number | null;
  /** True while every deliverable shows its summary and touched-node chips. */
  detailed: boolean;
  onYearChange: (year: number | null) => void;
  onMonthChange: (month: number | null) => void;
  onDetailedChange: (detailed: boolean) => void;
  /** Clear both period filters at once. */
  onReset: () => void;
}

/**
 * The Changelog's right rail: when am I looking at, and how much of it.
 *
 * Two groups because they are two questions. "When" holds the Year and Month
 * menus — they narrow independently, "every March" being a fair question of a
 * release cadence — and a Reset that only exists while one is set. "View"
 * holds the details toggle, whose state is carried by its glyph and
 * `aria-pressed`, never the filled surface: on this rail, filled means "a
 * filter is set", and a toggle that is on is a different thing.
 */
export function ChangelogRail({
  years,
  year,
  month,
  detailed,
  onYearChange,
  onMonthChange,
  onDetailedChange,
  onReset,
}: ChangelogRailProps) {
  useShortcut("toggle-expand", toolbarKey(() => onDetailedChange(!detailed)), GUARDED_HOTKEY);

  const filtered = year !== null || month !== null;

  return (
    <RightRail label="Changelog filters">
      <RailGroup label="When">
        <Select
          value={year === null ? ALL : String(year)}
          onValueChange={(value) => onYearChange(value === ALL ? null : Number(value))}
        >
          <FilterSelectTrigger
            variant="rail"
            tooltipSide="left"
            icon={<CalendarRangeIcon />}
            label="Year"
            active={year !== null}
            valueLabel={year === null ? undefined : String(year)}
          />
          <SelectContent side="left" align="start">
            <SelectItem value={ALL}>All years</SelectItem>
            {years.map((entry) => (
              <SelectItem key={entry} value={String(entry)}>
                {entry}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={month === null ? ALL : String(month)}
          onValueChange={(value) => onMonthChange(value === ALL ? null : Number(value))}
        >
          <FilterSelectTrigger
            variant="rail"
            tooltipSide="left"
            icon={<CalendarIcon />}
            label="Month"
            active={month !== null}
            valueLabel={month === null ? undefined : MONTH_LABELS[month]}
          />
          <SelectContent side="left" align="start">
            <SelectItem value={ALL}>All months</SelectItem>
            {MONTH_LABELS.map((label, index) => (
              <SelectItem key={label} value={String(index)}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtered && <RailButton icon={FilterXIcon} label="Reset filters" onClick={onReset} />}
      </RailGroup>

      <RailGroup label="View">
        <RailButton
          icon={detailed ? ListChevronsDownUpIcon : ListChevronsUpDownIcon}
          // A fixed name: `aria-pressed` already says whether it is on, and a
          // name that flipped too would announce the state twice.
          label="Deliverable details"
          pressed={detailed}
          onClick={() => onDetailedChange(!detailed)}
        />
      </RailGroup>
    </RightRail>
  );
}
