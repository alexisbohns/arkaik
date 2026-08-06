"use client";

import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui Separator, current generation (audit `shadcn-10`).
 *
 * The size classes stay branched in JS instead of moving to upstream's
 * `data-[orientation=vertical]:h-full` form, and that is load-bearing: a
 * variant-prefixed utility and a plain one are not the same key to
 * tailwind-merge, so `cn` cannot let a caller's `h-4` displace a
 * `data-[orientation=vertical]:h-full` — both would ship, and the variant
 * utility sorts last and wins. `PageHeader` passes exactly that (`h-4` on a
 * vertical rule), so upstream's form would silently stretch it to full height.
 */
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
