"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ReleaseEntry } from "@/components/journal/release-entry";

interface ReleasePickerProps {
  entries: readonly ReleaseEntry[];
  /** Always set: the picker only renders while the list has a row. */
  value: string;
  onChange: (key: string) => void;
}

/**
 * The release list folded into a menu, for a surface too narrow for two
 * columns — an open node panel, or a phone.
 */
export function ReleasePicker({ entries, value, onChange }: ReleasePickerProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Release" className="w-full">
        <SelectValue placeholder="Pick a release" />
      </SelectTrigger>
      <SelectContent>
        {entries.map((entry) => (
          <SelectItem key={entry.key} value={entry.key}>
            {entry.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
