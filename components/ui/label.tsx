"use client";

/**
 * The stock shadcn/ui Label — the primitive `@radix-ui/react-label` was already
 * a dependency for, with nothing importing it (audit `shadcn-4`).
 *
 * Its value over a bare `<label>` is the click behaviour on non-native controls:
 * Radix forwards a label click to the referenced element even when that element
 * is a `<button>` (which is what every `SelectTrigger` in this app is), and it
 * suppresses the text selection a double-click on a label would otherwise leave
 * behind. Everything else — `htmlFor`, the accessible name — is plain HTML.
 *
 * The repo's uppercase micro-label style is NOT baked in here: it belongs to the
 * field group, so it lives in `components/ui/field.tsx`, which composes this.
 */

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";

import { cn } from "@/lib/utils";

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Label };
