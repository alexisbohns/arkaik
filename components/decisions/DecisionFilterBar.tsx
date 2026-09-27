"use client";

import { CircleFadingArrowUpIcon, ListChevronsDownUpIcon, ListChevronsUpDownIcon } from "lucide-react";
import { Toolbar, ToolbarGroup } from "@/components/layout/Toolbar";
import { FilterSelectTrigger } from "@/components/layout/FilterSelectTrigger";
import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DECISION_STATUSES, type DecisionStatusId } from "@/lib/config/decision-statuses";

export type DecisionStatusFilter = DecisionStatusId | "all";

/** The "no filter" value. Already a real string, so Radix's Select can hold it. */
const ALL = "all";

interface DecisionFilterBarProps {
  search: string;
  onSearchChange: (query: string) => void;
  status: DecisionStatusFilter;
  onStatusChange: (status: DecisionStatusFilter) => void;
  /** Total decisions, for the "All statuses" entry. */
  total: number;
  /** How many decisions carry each status. Missing means zero. */
  counts: ReadonlyMap<DecisionStatusId, number>;
  /** True while every decision shows its rationale and its edge chips. */
  detailed: boolean;
  onDetailedChange: (detailed: boolean) => void;
}

/**
 * The Decision Log's toolbar: which decisions, and how much of each.
 *
 * Built to the shape every other band here has: search at the start, the
 * "narrow it" controls at the end. Status is the only thing there is to narrow
 * by on this surface, so it is one icon menu beside the detail toggle rather
 * than the row of seven count pills this replaced — a row that spent the whole
 * left half of the band on a filter, and left the surface with no way to find a
 * decision by name at all.
 *
 * **The counts follow the filter into the menu.** "Proposed · 4" was worth
 * keeping — it is a reason to click, which the same number in the page header
 * would not be — so each entry still carries its count; it is simply read where
 * the choice is made instead of occupying the band at rest.
 *
 * The detail toggle is the Changelog's, down to the glyph pair and the
 * border-only treatment: both surfaces are a timeline whose entries carry prose
 * under the title, and a reader scanning for one decision among forty wants the
 * same fold there as here.
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
}: DecisionFilterBarProps) {
  const toggleLabel = detailed ? "Collapse decision details" : "Expand decision details";

  return (
    <Toolbar>
      <ToolbarGroup className="w-full flex-1 md:max-w-sm">
        <SearchInput
          value={search}
          onChange={onSearchChange}
          placeholder="Search decisions…"
          aria-label="Search decisions"
          className="min-w-0 flex-1"
        />
      </ToolbarGroup>

      <ToolbarGroup>
        <Select
          value={status}
          onValueChange={(value) => onStatusChange(value === ALL ? "all" : (value as DecisionStatusId))}
        >
          <FilterSelectTrigger
            icon={<CircleFadingArrowUpIcon />}
            label="Status"
            active={status !== "all"}
            valueLabel={DECISION_STATUSES.find((entry) => entry.id === status)?.label}
          />
          <SelectContent align="start">
            <SelectItem value={ALL}>All statuses · {total}</SelectItem>
            {/* The shared vocabulary, so a decision status reads here in the
                same glyph and the same colour it wears on the rail below and in
                its panel — the counts ride along as the label's suffix. */}
            <StatusSelectItems vocabulary="decision-status" counts={counts} />
          </SelectContent>
        </Select>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-pressed={detailed}
              aria-label={toggleLabel}
              onClick={() => onDetailedChange(!detailed)}
              // Border only, no fill: the menu beside it uses a soft filled
              // surface to say "a value is set", and this button sets no value —
              // it opens and shuts the prose and chips under each decision.
              className="bg-transparent dark:bg-transparent"
            >
              {detailed ? <ListChevronsDownUpIcon className="size-4" /> : <ListChevronsUpDownIcon className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{toggleLabel}</TooltipContent>
        </Tooltip>
      </ToolbarGroup>
    </Toolbar>
  );
}
