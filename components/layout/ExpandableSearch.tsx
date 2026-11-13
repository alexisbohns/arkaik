"use client";

import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ExpandableSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "aria-label": string;
  /** Classes for the expanded field's wrapper — its width. */
  className?: string;
}

/**
 * A search that rests as an icon button and opens into the field.
 *
 * Collapsed, it costs a toolbar one square beside the filter menus; opened, it
 * is the ordinary `SearchInput`. It stays open for as long as it holds a query —
 * a search that hid what it was searching for would leave the reader looking at
 * a narrowed board with nothing on screen saying why. Empty, it folds back on
 * blur; Escape clears it and folds it at once.
 */
export function ExpandableSearch({ value, onChange, placeholder, "aria-label": label, className }: ExpandableSearchProps) {
  const [opened, setOpened] = useState(false);
  const expanded = opened || value !== "";

  if (!expanded) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label={label}
            onClick={() => setOpened(true)}
            className="cursor-pointer"
          >
            <SearchIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <SearchInput
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={label}
      // Only when the reader opened it: a field that mounts expanded because it
      // already holds a query (a filter restored on arrival) must not steal focus.
      autoFocus={opened}
      onBlur={() => {
        if (value === "") setOpened(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onChange("");
        setOpened(false);
      }}
      className={cn("w-56", className)}
    />
  );
}
