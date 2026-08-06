import * as React from "react";
import { SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The icon-inside-Input search field, rebuilt at four filter bars before this
 * existed (audit `factorization-11`).
 *
 * It standardises on `left-2.5 top-1/2 -translate-y-1/2` — the centering
 * `AcceptanceFilterBar` uses. The other three hardcoded `left-2 top-2.5`, which
 * is not centering at all: it is the arithmetic for today's `h-9` Input written
 * out as a constant, so the day the Input's height or padding changes, three
 * search icons sit off-centre and one does not.
 *
 * `className` lands on the positioning wrapper, not the Input, because that is
 * what every call site actually varies (`min-w-[12rem] flex-1`, `w-full
 * md:max-w-md`, `min-w-0 flex-1`) — the field itself is always full-width inside
 * it.
 *
 * `aria-label` is required: the control has an icon and a placeholder and no
 * visible label, so without one it reaches a screen reader as an unnamed text
 * field. All four call sites already pass one; the type keeps the fifth honest.
 */

interface SearchInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "className"> {
  value: string;
  /** Receives the new text, not the event — no call site wants the event. */
  onChange: (value: string) => void;
  "aria-label": string;
  /** Classes for the wrapper that sizes the field (width, flex), not the input. */
  className?: string;
}

export function SearchInput({ value, onChange, className, ...props }: SearchInputProps) {
  return (
    <div data-slot="search-input" className={cn("relative", className)}>
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      {/* Deliberately not `type="search"`: WebKit adds its own clear affordance
          to that type, which would sit under the bar's existing Clear button on
          one browser and nowhere else. */}
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pl-8"
        {...props}
      />
    </div>
  );
}
