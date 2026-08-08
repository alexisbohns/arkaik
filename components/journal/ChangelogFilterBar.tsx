"use client";

import { CalendarIcon, CalendarRangeIcon, ListChevronsDownUpIcon, ListChevronsUpDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FilterSelectTrigger } from "@/components/layout/FilterSelectTrigger";
import { Toolbar, ToolbarGroup } from "@/components/layout/Toolbar";
import { MONTH_LABELS } from "@/lib/utils/changelog-period";

/** The "no filter" sentinel — Radix's Select cannot hold an empty string value. */
const ALL = "__all__";

interface ChangelogFilterBarProps {
  /** Years present in the timeline, newest first. */
  years: readonly number[];
  year: number | null;
  month: number | null;
  /** True while every deliverable shows its summary and touched-node chips. */
  detailed: boolean;
  onYearChange: (year: number | null) => void;
  onMonthChange: (month: number | null) => void;
  onDetailedChange: (detailed: boolean) => void;
}

/**
 * The Changelog's band: when am I looking at, and how much of it.
 *
 * Two square icon menus and one icon toggle, the vocabulary the other filter
 * bands settled on (#374, #373) — a menu carries its value as a darkened border
 * and its name in the tooltip, a toggle carries its state in the glyph.
 *
 * Month is offered whatever the year filter says: "every March" is a question a
 * release cadence makes sense of, so the two narrow independently rather than
 * the month waiting on a year.
 */
export function ChangelogFilterBar({
  years,
  year,
  month,
  detailed,
  onYearChange,
  onMonthChange,
  onDetailedChange,
}: ChangelogFilterBarProps) {
  return (
    <Toolbar>
      <ToolbarGroup>
        <Select
          value={year === null ? ALL : String(year)}
          onValueChange={(value) => onYearChange(value === ALL ? null : Number(value))}
        >
          <FilterSelectTrigger
            icon={<CalendarRangeIcon />}
            label="Year"
            active={year !== null}
            valueLabel={year === null ? undefined : String(year)}
          />
          <SelectContent align="start">
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
            icon={<CalendarIcon />}
            label="Month"
            active={month !== null}
            valueLabel={month === null ? undefined : MONTH_LABELS[month]}
          />
          <SelectContent align="start">
            <SelectItem value={ALL}>All months</SelectItem>
            {MONTH_LABELS.map((label, index) => (
              <SelectItem key={label} value={String(index)}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ToolbarGroup>

      {/* Its own group, so the band's `justify-between` pushes it to the right
          edge: the two menus answer "when am I looking at", the toggle answers
          "how much of it", and they are not the same question. */}
      <ToolbarGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-pressed={detailed}
              aria-label={detailed ? "Collapse deliverable details" : "Expand deliverable details"}
              onClick={() => onDetailedChange(!detailed)}
              // Border only, no fill: the menus beside it use a soft filled
              // surface to say "a value is set", and this button sets no value —
              // it opens and shuts the notes and chips under each deliverable.
              className="bg-transparent dark:bg-transparent"
            >
              {detailed ? <ListChevronsDownUpIcon className="size-4" /> : <ListChevronsUpDownIcon className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{detailed ? "Collapse deliverable details" : "Expand deliverable details"}</TooltipContent>
        </Tooltip>
      </ToolbarGroup>
    </Toolbar>
  );
}
